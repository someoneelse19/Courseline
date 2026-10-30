#!/bin/bash
# Starts Courseline on http://localhost:5173. It does not open a browser tab: go to that address yourself.
#
#   Double-click this file in Finder, or run:  ./start-courseline.command
#   Stop it with Ctrl-C (or by closing the Terminal window).
#
# Options (environment variables):
#   OPEN=1      also open it in your default browser once it is ready (off by default)
#   PORT=5174   use another port (the browser extension only talks to 5173-5180 and 4173)

set -u
cd "$(dirname "$0")" || exit 1

PORT="${PORT:-5173}"
URL="http://localhost:${PORT}"
# The page title: both editions have it (the API-token edition drops the extension's courseline-app tag).
APP_MARKER='<title>Courseline</title>'

say() { printf '\n%s\n' "$*"; }
fail() { say "✗ $*"; printf '\nPress Return to close this window.'; read -r _; exit 1; }

# --- Node: courseline needs 22.13 or newer. Look on PATH first, then the usual places. ---
node_ok() {
  "$1" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)' 2>/dev/null
}

find_node() {
  local candidate
  if command -v node >/dev/null 2>&1; then
    candidate="$(command -v node)"
    node_ok "$candidate" && { echo "$candidate"; return 0; }
  fi
  for candidate in \
    "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME"/.volta/bin/node \
    "$HOME"/.fnm/aliases/default/bin/node \
    /opt/homebrew/bin/node \
    /opt/homebrew/opt/node@22/bin/node \
    /usr/local/bin/node \
    "$HOME"/Library/Application\ Support/com.raycast.macos/node/runtime/*/bin/node; do
    if [ -x "$candidate" ] && node_ok "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

# --- Already running? Then just open it. ---
# Both checks: the page has Courseline's title AND Vite's dev client is served (a plain file server would also show
# index.html, but only the dev server answers /@vite/client).
# (10 s each: a busy machine can make even the dev server slow to answer, and being slow is not being someone else's.)
if curl -s -m 10 "$URL/" 2>/dev/null | grep -qF "$APP_MARKER" && [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$URL/@vite/client" 2>/dev/null)" = "200" ]; then
  say "✓ Courseline is already running at $URL"
  [ -n "${OPEN:-}" ] && open "$URL"
  exit 0
fi

# Something else on the port would make Vite pick a different one, which the extension would not recognise.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Port $PORT is in use, and what is there did not answer like Courseline (it may just be slow right now: if it is Courseline, open $URL). Otherwise close the other program, or run:  PORT=5174 ./start-courseline.command"
fi

NODE="$(find_node)" || fail "Could not find Node 22.13 or newer. Install it from https://nodejs.org (the LTS 22 version), then run this again."

[ -f node_modules/vite/bin/vite.js ] || fail "The project's packages are not installed yet. In this folder run:  npm install   (then run this again)."

say "Starting Courseline with Node $("$NODE" -v). Open $URL in your browser when it says ready."

# Only when asked (OPEN=1): open the browser once the server answers, in the background so Vite keeps this window.
if [ -n "${OPEN:-}" ]; then
  (
    for _ in $(seq 1 80); do
      if curl -s -o /dev/null -m 1 "$URL/" 2>/dev/null; then
        open "$URL"
        exit 0
      fi
      sleep 0.5
    done
  ) &
fi

# Vite stops (or stops answering) when its input is closed. Started from a Shortcut, a launcher or with
# `< /dev/null` there is no terminal, so give it an input that stays open: a pipe this script holds both ends of.
if [ ! -t 0 ]; then
  keepalive="$(mktemp -u "${TMPDIR:-/tmp}/courseline-stdin.XXXXXX")"
  if mkfifo "$keepalive" && exec 3<>"$keepalive"; then
    rm -f "$keepalive"
    exec 0<&3
  fi
fi

# --strictPort: if the port is taken, stop instead of quietly using another one.
"$NODE" node_modules/vite/bin/vite.js --port "$PORT" --strictPort
code=$?
[ "$code" -ne 0 ] && say "Courseline stopped with an error (exit code $code)."
exit "$code"
