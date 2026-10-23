#!/usr/bin/env bash
# Install dependencies and start the API (http://localhost:8000) and the web app
# (http://localhost:5173) together. Ctrl-C stops both.
#
# Usage: ./start.sh [--skip-install]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_PORT=8000
SKIP_INSTALL=false

for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=true ;;
    -h | --help)
      sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
fail() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

require() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is not installed. $2"
}

# --- Prerequisites ------------------------------------------------------------

info "Checking prerequisites"
require node "Install Node $(cat "$ROOT/.nvmrc") (e.g. 'nvm install')."
require pnpm "Run 'corepack enable' to use the pnpm version pinned in package.json."
require uv "See https://docs.astral.sh/uv/ to install it."
require make "Install the Xcode command line tools or build-essential."

node_major="$(node -p 'process.versions.node.split(".")[0]')"
wanted_major="$(cat "$ROOT/.nvmrc")"
if [ "$node_major" -lt "$wanted_major" ]; then
  fail "Node $wanted_major+ is required, found $(node -v). Run 'nvm use'."
fi

for port in "$API_PORT" 5173; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Port $port is already in use. Stop whatever is running there first."
  fi
done

# --- Install ------------------------------------------------------------------

if [ "$SKIP_INSTALL" = false ]; then
  info "Installing root dependencies (git hooks)"
  pnpm --dir "$ROOT" install

  info "Installing web dependencies"
  pnpm --dir "$ROOT/web" install

  info "Installing API dependencies"
  make -C "$ROOT/api" install
fi

make -C "$ROOT/api" --no-print-directory env
if ! grep -Eq '^(ANTHROPIC|OPENROUTER)_API_KEY=.+' "$ROOT/api/.env"; then
  printf '\033[33mwarning:\033[0m no API key set in api/.env. The editor works, but AI requests will fail.\n'
fi

# --- Run ----------------------------------------------------------------------

# On exit (Ctrl-C, or either app dying), stop everything in this process group.
cleanup() {
  trap - INT TERM EXIT
  info "Stopping"
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

info "Starting API on http://localhost:$API_PORT"
make -C "$ROOT/api" --no-print-directory dev PORT="$API_PORT" &
api_pid=$!

info "Waiting for the API to become healthy"
for _ in $(seq 1 60); do
  if curl -fs "http://localhost:$API_PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  kill -0 "$api_pid" 2>/dev/null || fail "The API exited during startup"
  sleep 0.5
done

info "Starting web app on http://localhost:5173"
pnpm --dir "$ROOT/web" dev &
web_pid=$!

# Exit as soon as either app stops (bash 3.2 on macOS has no 'wait -n').
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 1
done
