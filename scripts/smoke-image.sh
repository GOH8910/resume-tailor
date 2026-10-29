#!/usr/bin/env bash
# Builds the production image and checks it end to end against a throwaway Postgres: health, sign-in, a real
# compile, that TeX runs as separate users (one per compile slot) who cannot read the server's secrets or data or
# each other's compile folders, and that a burst of compiles beyond the queue's limit is turned away with a 503.
# Usage: scripts/smoke-image.sh   (needs Docker, curl and Node; builds for this machine's architecture)
# SMOKE_SKIP_BUILD=1 reuses an existing resume-tailor:smoke image. SMOKE_PORT picks the host port.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE=resume-tailor:smoke
# Suffixed with this shell's PID so two runs cannot collide.
NET=resume-smoke-$$
DB=resume-smoke-db-$$
APP=resume-smoke-app-$$
PORT=${SMOKE_PORT:-$((20000 + $$ % 10000))}
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
# as USER COMMAND: runs COMMAND in the app container as USER (tex1, tex2: the TeX users of compile slots 1 and 2).
as() { docker exec -u "$1" "$APP" sh -c "$2"; }
# The API checks that Origin matches Host on every /api request.
api() { curl -sS -b "$JAR" -c "$JAR" -H "Origin: $BASE" "$@"; }
# Posts $WORK/compile.json to /api/compile; saves body and headers as $WORK/<name>.body/.headers, prints the status.
# Reads the cookie jar without writing it back, so many can run at once.
compile_as() {
  curl -sS -b "$JAR" -H "Origin: $BASE" -D "$WORK/$1.headers" -o "$WORK/$1.body" -w '%{http_code}' \
    -H 'Content-Type: application/json' --data-binary @"$WORK/compile.json" "$BASE/api/compile" || true
}
# One line per process in the app container: its command line.
processes() { in_app 'for f in /proc/[0-9]*/cmdline; do tr "\0" " " < "$f" 2>/dev/null; echo; done'; }

# --- Build ---
if [ "${SMOKE_SKIP_BUILD:-}" != 1 ]; then
  started=$(date +%s)
  docker build -t "$IMAGE" .
  echo "Build took $(($(date +%s) - started)) s"
fi
# Docker Desktop's containerd image store reports the compressed size here; the classic store, the unpacked size.
echo "Image size: $(docker image inspect --format '{{.Size}}' "$IMAGE" | awk '{ printf "%.0f MB", $1 / 1000 / 1000 }')"

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

docker run -d --name "$APP" --network "$NET" --init -p "127.0.0.1:$PORT:3000" \
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
# The probe runs latexmk through sudo as the last compile slot's user (tex2), so this also proves that user exists.
check "health probe runs latexmk as the last slot's user" test "$(echo "$health" | grep -o '"latexmk":"[^"]*"')" = '"latexmk":"ok"'

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
pages=$(tr -d '\r' 2>/dev/null < "$WORK/compile.headers" | awk -F': ' 'tolower($1) == "x-page-count" { print $2 }' || true)
check "compile returned a PDF (HTTP $code)" test "$code" = 200
if [ "$code" != 200 ]; then
  json "$WORK/compiled" error 2>/dev/null || true
  echo
  { json "$WORK/compiled" log 2>/dev/null || true; } | tail -c 2000
  echo
fi
check "compiled resume is one page (X-Page-Count: ${pages:-none})" test "${pages:-}" = 1
type=$(api -o /dev/null -w '%{content_type}' "$BASE/api/applications/$id/pdf" || true)
check "saved PDF is served ($type)" test "$type" = application/pdf
check "compile folders were cleaned up" test -z "$(in_app 'ls -A /var/lib/compile')"

# --- TeX runs as a separate user ---
# Next renames its process to "next-server (v...)".
server_pid=$(in_app 'for p in /proc/[0-9]*; do case "$(tr "\0" " " < "$p/cmdline" 2>/dev/null)" in next-server*|"node server.js"*) basename "$p";; esac; done' | head -1 || true)
check "found the server process (pid ${server_pid:-none})" test -n "$server_pid"
check "control: node can read the server's environment" in_app "grep -qz '^BETTER_AUTH_SECRET=' /proc/$server_pid/environ"
for user in tex1 tex2; do
  refused "$user cannot read the server's environment" as "$user" "cat /proc/$server_pid/environ"
  refused "$user cannot read /proc/1/environ" as "$user" 'cat /proc/1/environ'
  refused "$user cannot list /app/data" as "$user" 'ls /app/data'
  refused "$user cannot read the app's code" as "$user" 'ls /app'
  refused "$user cannot list the compile folders" as "$user" 'ls /var/lib/compile'
  check "sudo runs commands as $user" test "$(in_app "sudo -n -u $user /usr/bin/timeout 5 id -un" || true)" = "$user"
done
check "sudo passes openout_any=p to tex1" in_app 'openout_any=p sudo -n -u tex1 /usr/bin/timeout 5 env | grep -qx openout_any=p'
refused "sudo keeps the server's secrets from tex1" in_app \
  'sudo -n -u tex1 /usr/bin/timeout 5 env | grep -q -e DATABASE_URL -e BETTER_AUTH_SECRET -e ANTHROPIC_API_KEY'
refused "sudo lets node run only GNU timeout as tex1" in_app 'sudo -n -u tex1 env'
refused "sudo does not let node become root" in_app 'sudo -n true'
refused "sudo does not let node run as a user outside the slots" in_app 'sudo -n -u nobody /usr/bin/timeout 5 id'

# A compile folder as compileTex makes it for slot 1: created by node, handed to group texrun1, setgid 2770.
slot1_dir=$(in_app 'd=$(mktemp -d /var/lib/compile/smoke-XXXXXX) && chgrp texrun1 "$d" && chmod 2770 "$d" && echo "$d"' || true)
check "control: tex1 can work in its slot's folder" as tex1 "cd $slot1_dir && touch from-tex1"
refused "tex2 cannot enter slot 1's folder" as tex2 "cd $slot1_dir"
refused "tex2 cannot read slot 1's files" as tex2 "cat $slot1_dir/from-tex1"
check "node can read what tex1 wrote there" in_app "test -r $slot1_dir/from-tex1"
in_app "rm -rf $slot1_dir" || true

status=$(in_app 'sudo -n -u tex1 /usr/bin/timeout 2 sleep 10; echo $?' || true)
check "GNU timeout stops a tex1 command (exit $status)" test "$status" = 124
check "no sleep process is left behind" test -z "$(processes | grep '^sleep 10' || true)"

# The same command line the app uses, on documents that try to escape or never finish.
tex_run() {
  docker exec -i "$APP" sh -s "$1" "$2" <<'SH'
d=$(mktemp -d /var/lib/compile/smoke-XXXXXX) && chgrp texrun1 "$d" && chmod 2770 "$d" && cd "$d" || exit 99
printf '%s\n' "$2" > doc.tex
openout_any=p sudo -n -u tex1 -- /usr/bin/timeout -k 3 "$1" latexmk -norc -no-shell-escape -pdf \
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

# --- Concurrent compiles run as different slot users ---
# Records the real uid of every TeX process (not sudo, which runs as root for node) until told to stop.
watch_tex_uids() {
  docker exec "$APP" sh -c 'rm -f /tmp/smoke-stop; until [ -e /tmp/smoke-stop ]; do
    for p in /proc/[0-9]*; do
      # stderr first: a process that exits mid-scan makes the redirection itself fail.
      case "$(tr "\0" " " 2>/dev/null < "$p/cmdline")" in
        sudo*|*smoke-stop*) ;;
        *latexmk*|pdflatex*) awk "/^Uid:/ { print \$2 }" "$p/status" 2>/dev/null ;;
      esac
    done
  done | sort -u'
}
watch_tex_uids > "$WORK/tex-uids" &
watcher=$!
sleep 1
pids=()
for i in 1 2 3; do compile_as "burst-$i" > "$WORK/burst-$i.code" & pids+=($!); done
wait "${pids[@]}"
in_app 'touch /tmp/smoke-stop'
wait "$watcher" || true
codes=$(for i in 1 2 3; do cat "$WORK/burst-$i.code"; echo; done | tr '\n' ' ')
check "three concurrent compiles all succeed (HTTP $codes)" test "$codes" = "200 200 200 "
expected_uids=$(in_app 'id -u tex1; id -u tex2' | sort -u | tr '\n' ' ')
seen_uids=$(tr '\n' ' ' < "$WORK/tex-uids")
check "TeX ran as tex1 and tex2, and as no one else (uids seen: ${seen_uids:-none})" test "$seen_uids" = "$expected_uids"
check "compile folders were cleaned up after the burst" test -z "$(in_app 'ls -A /var/lib/compile')"

# --- The compile queue turns a burst away once 8 are waiting ---
# COMPILE_CONCURRENCY 2 running + 8 waiting: of 14 at once, at least one must be refused, and only with a 503.
pids=()
for i in $(seq 14); do compile_as "flood-$i" > "$WORK/flood-$i.code" & pids+=($!); done
wait "${pids[@]}"
ok=0
busy=0
busy_ok=0
for i in $(seq 14); do
  case "$(cat "$WORK/flood-$i.code")" in
    200) ok=$((ok + 1)) ;;
    503)
      busy=$((busy + 1))
      if grep -qi '^retry-after: 10' "$WORK/flood-$i.headers" && [ "$(json "$WORK/flood-$i.body" details.retryAfter)" = 10 ]; then
        busy_ok=$((busy_ok + 1))
      fi
      ;;
  esac
done
check "a burst of 14 compiles: $ok succeeded, $busy turned away, none failed otherwise" test $((ok + busy)) = 14 -a "$ok" -ge 10
check "the queue turned at least one away with a 503" test "$busy" -ge 1
check "every 503 carries Retry-After: 10 and details.retryAfter" test "$busy_ok" = "$busy"
check "compile folders were cleaned up after the flood" test -z "$(in_app 'ls -A /var/lib/compile')"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "Smoke test FAILED: $FAILURES check(s) failed."
  exit 1
fi
echo "Smoke test passed."
