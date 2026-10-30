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

# Each compile slot runs TeX as its own user (see docker/sudoers-latex and src/latex/slot-user.ts): slot n is user
# texN with its own group texrunN, which node is also in. That isolates TeX from the server (a document cannot read
# the app's environment under /proc, /app or /app/data) and one running compile from another: each compile folder
# is handed to its slot's group and closed to everyone else, and no TeX user can read another's processes.
# Compile folders live under /var/lib/compile: node owns it, and the TeX users (group texrun) may pass through it
# but not list it. COMPILE_CONCURRENCY compiles run at once, so it must not exceed COMPILE_SLOTS.
ARG COMPILE_SLOTS=2
ARG COMPILE_CONCURRENCY=2
COPY docker/sudoers-latex /tmp/sudoers-latex
RUN [ "$COMPILE_SLOTS" -ge 1 ] && [ "$COMPILE_CONCURRENCY" -ge 1 ] \
 && { [ "$COMPILE_CONCURRENCY" -le "$COMPILE_SLOTS" ] \
      || { echo "COMPILE_CONCURRENCY ($COMPILE_CONCURRENCY) must not exceed COMPILE_SLOTS ($COMPILE_SLOTS)" >&2; exit 1; }; } \
 && groupadd texrun \
 && users="" \
 && for n in $(seq 1 "$COMPILE_SLOTS"); do \
      groupadd "texrun$n" \
      && useradd --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin \
           --no-user-group --gid "texrun$n" --groups texrun "tex$n" \
      && usermod -aG "texrun$n" node \
      && users="${users:+$users,}tex$n" || exit 1; \
    done \
 && install -d -o node -g texrun -m 0710 /var/lib/compile \
 && sed -e "/^Defaults:node secure_path=/s|@TEXBIN@|$(readlink -f /usr/local/texlive/bin/current)|" \
        -e "s|@TEXUSERS@|$users|" /tmp/sudoers-latex > /etc/sudoers.d/latex \
 && rm /tmp/sudoers-latex \
 && ! grep -q '@TEXBIN@\|@TEXUSERS@\|secure_path=":' /etc/sudoers.d/latex \
 && chmod 0440 /etc/sudoers.d/latex \
 && visudo -c -f /etc/sudoers.d/latex

ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 LATEX_RUN_AS=tex COMPILE_ROOT=/var/lib/compile \
    COMPILE_CONCURRENCY=$COMPILE_CONCURRENCY
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/templates ./templates
COPY --from=build /app/drizzle ./drizzle
# The app's code stays root-owned (node cannot change it) and closed to tex; node can write only data/ and the
# Next cache.
RUN chown root:node /app && chmod 750 /app \
 && install -d -o node -g node -m 700 /app/data \
 && install -d -o node -g node -m 755 /app/.next/cache
EXPOSE 3000
# The server runs as node, and needs node's texrunN groups to hand each compile folder to its slot's TeX user. Fly's
# init applies an image's USER without its supplementary groups, so the image starts as root and setpriv drops to node
# with all of node's groups (sudo still works: setpriv sets no no_new_privs flag). A failed drop stops the start.
ENTRYPOINT ["setpriv", "--reuid=node", "--regid=node", "--init-groups", "--"]
CMD ["node", "server.js"]
