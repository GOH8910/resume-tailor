# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NODE_ENV=production
RUN npm run build

# Minimal TeX Live: only what templates/resume.tex needs. tlmgr pulls in dependencies.
FROM base AS texlive
ARG TARGETARCH
# gnupg lets install-tl verify the signature of the TeX Live package database.
RUN apt-get update && apt-get install -y --no-install-recommends perl wget ca-certificates xz-utils gnupg \
 && rm -rf /var/lib/apt/lists/*
COPY docker/texlive.profile /tmp/texlive.profile
RUN mkdir /tmp/install-tl && cd /tmp/install-tl \
 && wget -qO- https://mirror.ctan.org/systems/texlive/tlnet/install-tl-unx.tar.gz | tar xz --strip-components=1 \
 && ./install-tl -profile /tmp/texlive.profile -no-interaction \
 && rm -rf /tmp/install-tl /tmp/texlive.profile
# TeX Live names its binary folder by platform: x86_64-linux on Fly, aarch64-linux for local arm64 builds.
RUN case "$TARGETARCH" in \
      amd64) arch=x86_64-linux ;; \
      arm64) arch=aarch64-linux ;; \
      *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && ln -s "$arch" /usr/local/texlive/bin/current
ENV PATH=/usr/local/texlive/bin/current:$PATH
# xkeyval, l3packages and etoolbox are needed by crimson and fontawesome5 but not pulled in by tlmgr; amsfonts has
# the Type 1 math fonts that symbols such as \geq and \times fall back to.
RUN tlmgr install latexmk latex-bin latex latex-fonts geometry titlesec enumitem hyperref url \
    fontawesome5 crimson fontaxes ec xkeyval l3packages etoolbox amsfonts \
 && rm -rf /usr/local/texlive/texmf-dist/doc /usr/local/texlive/texmf-dist/source /usr/local/texlive/tlpkg/backups
# tlmgr exits 0 even when a download fails. Compiling the template, with a line that uses its fonts and icons in
# place of the content marker, fails the build instead of the first compile in production.
COPY templates/resume.tex /tmp/check/resume.tex
RUN cd /tmp/check \
 && sed 's/^%%CONTENT%%$/Check: \\textbf{bold} \\textit{italic} \\faEnvelope\\ \\faGithub\\ $\\geq$ \\texttimes/' resume.tex > check.tex \
 && grep -q '^Check:' check.tex \
 && { latexmk -norc -pdf -interaction=nonstopmode -halt-on-error check.tex >/dev/null || { grep -A5 '^!' check.log; exit 1; }; } \
 && cd / && rm -rf /tmp/check

FROM base AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends perl sudo \
 && rm -rf /var/lib/apt/lists/*
COPY --from=texlive /usr/local/texlive /usr/local/texlive
ENV PATH=/usr/local/texlive/bin/current:$PATH

# TeX runs as "tex" (see docker/sudoers-latex), which isolates it from the server: a document cannot read the app's
# environment under /proc, /app or /app/data. It does not isolate one compile from another: every compile runs as
# tex, so if escaping ever failed a document could reach a concurrent compile's folder through /proc/<pid>/cwd.
# Compile folders live under /var/lib/compile: node owns it, and its setgid group texrun (node and tex are both in
# it) is handed to each compile folder. Group members may enter it but not list it.
COPY docker/sudoers-latex /tmp/sudoers-latex
RUN useradd --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin tex \
 && groupadd texrun \
 && usermod -aG texrun tex \
 && usermod -aG texrun node \
 && install -d -o node -g texrun -m 2710 /var/lib/compile \
 && sed "/^Defaults:node secure_path=/s|@TEXBIN@|$(readlink -f /usr/local/texlive/bin/current)|" /tmp/sudoers-latex \
    > /etc/sudoers.d/latex \
 && rm /tmp/sudoers-latex \
 && ! grep -q '@TEXBIN@\|secure_path=":' /etc/sudoers.d/latex \
 && chmod 0440 /etc/sudoers.d/latex \
 && visudo -c -f /etc/sudoers.d/latex

ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 LATEX_RUN_AS=tex COMPILE_ROOT=/var/lib/compile
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/templates ./templates
COPY --from=build /app/drizzle ./drizzle
# The app's code stays root-owned (node cannot change it) and closed to tex; node can write only data/ and the
# Next cache.
RUN chown root:node /app && chmod 750 /app \
 && install -d -o node -g node -m 700 /app/data \
 && install -d -o node -g node -m 755 /app/.next/cache
USER node
EXPOSE 3000
CMD ["node", "server.js"]
