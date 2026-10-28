#!/usr/bin/env bash
# Builds the production image and checks it end to end against a throwaway Postgres: health, sign-in, a real
# compile, and that TeX runs as a separate user who cannot read the server's secrets or data.
# Usage: scripts/smoke-image.sh   (needs Docker, curl and Node; builds for this machine's architecture)
# SMOKE_SKIP_BUILD=1 reuses an existing resume-tailor:smoke image.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE=resume-tailor:smoke
NET=resume-smoke
DB=resume-smoke-db
APP=resume-smoke-app
PORT=3999
BASE="http://localhost:$PORT"
EMAIL=smoke@example.com
WORK=$(mktemp -d)
JAR="$WORK/cookies.txt"
FAILURES=0

remove_containers() {
  docker rm -f "$APP" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
cleanup() {
  remove_containers
  rm -rf "$WORK"
}
trap cleanup EXIT

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILURES=$((FAILURES + 1)); }
# check NAME COMMAND...: the command must succeed. refused NAME COMMAND...: it must fail.
check() { local name=$1; shift; if "$@"; then pass "$name"; else fail "$name"; fi; }
refused() { local name=$1; shift; if "$@" >/dev/null 2>&1; then fail "$name"; else pass "$name"; fi; }
# Prints the value at a dotted path (e.g. application.id) of the JSON file $1.
json() {
  node -e 'const v = process.argv[2].split(".").reduce((o, k) => o?.[k], JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")));
    process.stdout.write(typeof v === "string" ? v : JSON.stringify(v ?? null));' "$1" "$2"
}
in_app() { docker exec "$APP" sh -c "$1"; }
as_tex() { docker exec -u tex "$APP" sh -c "$1"; }
# The API checks that Origin matches Host on every /api request.
api() { curl -sS -b "$JAR" -c "$JAR" -H "Origin: $BASE" "$@"; }
# One line per process in the app container: its command line.
processes() { in_app 'for f in /proc/[0-9]*/cmdline; do tr "\0" " " < "$f" 2>/dev/null; echo; done'; }

# --- Build ---
if [ "${SMOKE_SKIP_BUILD:-}" != 1 ]; then
  started=$(date +%s)
  docker build -t "$IMAGE" .
  echo "Build took $(($(date +%s) - started)) s"
fi
echo "Image size: $(docker run --rm --entrypoint du "$IMAGE" -sxm / 2>/dev/null | cut -f1) MB unpacked"

# --- Start Postgres and the app ---
remove_containers
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -e POSTGRES_PASSWORD=postgres postgres:16-alpine >/dev/null
# Over TCP: during first-boot initialisation Postgres listens on its socket only, then restarts.
for _ in $(seq 60); do
  docker exec "$DB" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$DB" pg_isready -h 127.0.0.1 -U postgres >/dev/null || { echo "Postgres did not start"; exit 1; }

docker run -d --name "$APP" --network "$NET" --init -p "$PORT:3000" \
  -e DATABASE_URL="postgres://postgres:postgres@$DB:5432/postgres" \
  -e BETTER_AUTH_SECRET=smoke-test-secret-never-used-in-production-0123456789 \
  -e BETTER_AUTH_URL="$BASE" \
  -e EMAIL_TRANSPORT=file \
  -e EMAIL_FROM="Resume Tailor <signin@localhost>" \
  -e ANTHROPIC_API_KEY=sk-ant-smoke-dummy \
  "$IMAGE" >/dev/null

health=""
for _ in $(seq 90); do
  health=$(curl -sS "$BASE/api/health?deep=1" 2>/dev/null || true)
  [[ "$health" == *'"ok":true'* ]] && break
  sleep 1
done
echo "Health: $health"
if [[ "$health" != *'"ok":true'* ]]; then
  docker logs "$APP" 2>&1 | tail -40
  echo "The app did not become healthy"
  exit 1
fi
pass "deep health check"

# --- Sign in, save a bank, compile ---
code=$(api -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"callbackURL\":\"/\"}" "$BASE/api/auth/sign-in/magic-link" || true)
check "sign-in link requested (HTTP $code)" test "$code" = 200
link=$(docker exec "$APP" cat "/app/data/magic-links/$EMAIL.txt" 2>/dev/null || true)
code=$(curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" -c "$JAR" "$link" || true)
check "sign-in link redirects (HTTP $code)" test "$code" = 302
api -o "$WORK/session.json" "$BASE/api/auth/get-session" || true
check "session belongs to $EMAIL" test "$(json "$WORK/session.json" user.email)" = "$EMAIL"

code=$(api -o "$WORK/bank.json" -w '%{http_code}' -X PUT -H 'Content-Type: application/json' \
  --data-binary @data/example/bank.json "$BASE/api/bank" || true)
check "bank saved (HTTP $code)" test "$code" = 200

code=$(api -o "$WORK/application.json" -w '%{http_code}' -H 'Content-Type: application/json' \
  -d '{"jobDescription":"Build reliable backend services in TypeScript.","company":"Smoke Ltd","roleTitle":"Engineer"}' \
  "$BASE/api/applications" || true)
check "application created (HTTP $code)" test "$code" = 201
id=$(json "$WORK/application.json" application.id || true)
node -e 'const { application } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  require("fs").writeFileSync(process.argv[2], JSON.stringify({ resume: application.resume, applicationId: application.id }));' \
  "$WORK/application.json" "$WORK/compile.json" || true

code=$(api -D "$WORK/compile.headers" -o "$WORK/compiled" -w '%{http_code}' -H 'Content-Type: application/json' \
  --data-binary @"$WORK/compile.json" "$BASE/api/compile" || true)
pages=$(tr -d '\r' < "$WORK/compile.headers" | awk -F': ' 'tolower($1) == "x-page-count" { print $2 }')
check "compile returned a PDF (HTTP $code)" test "$code" = 200
if [ "$code" != 200 ]; then json "$WORK/compiled" error; echo; json "$WORK/compiled" log | tail -c 2000; echo; fi
check "compiled resume is one page (X-Page-Count: ${pages:-none})" test "${pages:-}" = 1
type=$(api -o /dev/null -w '%{content_type}' "$BASE/api/applications/$id/pdf" || true)
check "saved PDF is served ($type)" test "$type" = application/pdf
check "compile folders were cleaned up" test -z "$(in_app 'ls -A /var/lib/compile')"

# --- TeX runs as a separate user ---
# Next renames its process to "next-server (v...)".
server_pid=$(in_app 'for p in /proc/[0-9]*; do case "$(tr "\0" " " < "$p/cmdline" 2>/dev/null)" in next-server*|"node server.js"*) basename "$p";; esac; done' | head -1)
check "found the server process (pid ${server_pid:-none})" test -n "$server_pid"
check "control: node can read the server's environment" in_app "grep -qz '^BETTER_AUTH_SECRET=' /proc/$server_pid/environ"
refused "tex cannot read the server's environment" as_tex "cat /proc/$server_pid/environ"
refused "tex cannot read /proc/1/environ" as_tex 'cat /proc/1/environ'
refused "tex cannot list /app/data" as_tex 'ls /app/data'
refused "tex cannot read the app's code" as_tex 'ls /app'
refused "tex cannot list other compile folders" as_tex 'ls /var/lib/compile'

check "sudo runs commands as tex" test "$(in_app 'sudo -n -u tex /usr/bin/timeout 5 id -un' || true)" = tex
check "sudo passes openout_any=p to tex" in_app 'openout_any=p sudo -n -u tex /usr/bin/timeout 5 env | grep -qx openout_any=p'
refused "sudo keeps the server's secrets from tex" in_app \
  'sudo -n -u tex /usr/bin/timeout 5 env | grep -q -e DATABASE_URL -e BETTER_AUTH_SECRET -e ANTHROPIC_API_KEY'
refused "sudo lets node run only GNU timeout as tex" in_app 'sudo -n -u tex env'
refused "sudo does not let node become root" in_app 'sudo -n true'

status=$(in_app 'sudo -n -u tex /usr/bin/timeout 2 sleep 10; echo $?' || true)
check "GNU timeout stops a tex command (exit $status)" test "$status" = 124
check "no sleep process is left behind" test -z "$(processes | grep '^sleep 10' || true)"

# The same command line the app uses, on documents that try to escape or never finish.
tex_run() {
  docker exec -i "$APP" sh -s "$1" "$2" <<'SH'
d=$(mktemp -d /var/lib/compile/smoke-XXXXXX) && chmod 2770 "$d" && cd "$d" || exit 99
printf '%s\n' "$2" > doc.tex
openout_any=p sudo -n -u tex -- /usr/bin/timeout -k 3 "$1" latexmk -norc -no-shell-escape -pdf \
  -interaction=nonstopmode -halt-on-error doc.tex >/dev/null 2>&1
status=$?
echo "$status $(grep -c "I can't write on file" doc.log 2>/dev/null)"
cd / && rm -rf "$d"
SH
}
evil='\documentclass{article}\begin{document}x\newwrite\out\immediate\openout\out=/tmp/evil.txt \immediate\write\out{x}\immediate\closeout\out\end{document}'
read -r status refusals <<<"$(tex_run 30s "$evil" || true)"
check "TeX refuses to write /tmp/evil.txt (exit $status, $refusals refusal)" test "$status" != 0 -a "${refusals:-0}" -ge 1
refused "/tmp/evil.txt does not exist" in_app 'test -e /tmp/evil.txt'

loop='\documentclass{article}\begin{document}\def\x{\x}\x\end{document}'
read -r status _ <<<"$(tex_run 3s "$loop" || true)"
check "GNU timeout stops a TeX loop (exit $status)" test "$status" = 124
check "no TeX process is left behind" test -z "$(processes | grep -e '^pdflatex' -e 'latexmk' || true)"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "Smoke test FAILED: $FAILURES check(s) failed."
  exit 1
fi
echo "Smoke test passed."
