#!/usr/bin/env bash
# Installs mac-agent as a launchd user agent that starts at login.
#
# Renders launchd/com.stash.mac-agent.plist into ~/Library/LaunchAgents and bootstraps it into the
# current GUI session. Run it again to reinstall after changing paths or the env file.
#
#   ./install.sh           render, install and start the agent
#   ./install.sh --print   only print the rendered plist (works on any OS, touches nothing)
#
# Overrides (env):
#   NODE_BIN              node binary (default: `command -v node`)
#   PP_BIN                Proton Pass CLI (default: `command -v pp`)
#   STASH_AGENT_ENV_FILE  env file with STASH_API_URL and STASH_DEVICE_TOKEN (default: ./.env)
#   STASH_AGENT_LOG_DIR   log directory (default: ~/Library/Logs/stash-mac-agent)
#   LAUNCH_AGENTS_DIR     where the plist goes (default: ~/Library/LaunchAgents)
set -euo pipefail

LABEL="com.stash.mac-agent"
AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$AGENT_DIR/launchd/$LABEL.plist"

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
PP_BIN="${PP_BIN:-$(command -v pp || true)}"
ENV_FILE="${STASH_AGENT_ENV_FILE:-$AGENT_DIR/.env}"
LOG_DIR="${STASH_AGENT_LOG_DIR:-$HOME/Library/Logs/stash-mac-agent}"
LAUNCH_AGENTS_DIR="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"

die() {
  echo "install.sh: $*" >&2
  exit 1
}

# Escapes a value for an XML text node, then for the replacement side of a sed `s|||` command.
escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g' -e 's/[|&\\]/\\&/g'
}

render() {
  local path
  path="$(dirname "$NODE_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  local rendered
  rendered="$(sed \
    -e "s|__PP_BIN__|$(escape "$PP_BIN")|g" \
    -e "s|__NODE_BIN__|$(escape "$NODE_BIN")|g" \
    -e "s|__ENV_FILE__|$(escape "$ENV_FILE")|g" \
    -e "s|__AGENT_DIR__|$(escape "$AGENT_DIR")|g" \
    -e "s|__LOG_DIR__|$(escape "$LOG_DIR")|g" \
    -e "s|__PATH__|$(escape "$path")|g" \
    "$TEMPLATE")"
  if grep -q '__[A-Z_]*__' <<<"$rendered"; then
    die "unreplaced placeholder in $TEMPLATE"
  fi
  printf '%s\n' "$rendered"
}

[[ -f "$TEMPLATE" ]] || die "template not found: $TEMPLATE"
[[ -n "$NODE_BIN" ]] || die "node not found; install Node >= 24 or set NODE_BIN"
[[ -n "$PP_BIN" ]] || die "pp (Proton Pass CLI) not found; install it or set PP_BIN"

if [[ "${1:-}" == "--print" ]]; then
  render
  exit 0
fi
[[ $# -eq 0 ]] || die "unknown argument: $1 (usage: install.sh [--print])"

[[ "$(uname -s)" == "Darwin" ]] || die "launchd needs macOS; use --print to only render the plist"
[[ -f "$ENV_FILE" ]] || die "env file not found: $ENV_FILE (see README.md)"
[[ -d "$AGENT_DIR/node_modules" ]] || die "dependencies missing; run pnpm install first"

TARGET="$LAUNCH_AGENTS_DIR/$LABEL.plist"
DOMAIN="gui/$(id -u)"

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"
render >"$TARGET"
plutil -lint "$TARGET" >/dev/null || die "rendered plist is invalid: $TARGET"

# Reinstall: drop a loaded copy first, bootstrap fails if the label is already loaded.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$TARGET"

echo "Installed $LABEL ($TARGET)."
echo "Logs: $LOG_DIR/mac-agent.log and $LOG_DIR/mac-agent.err.log"
echo "Grant Full Disk Access to these binaries (see README.md):"
for bin in "$PP_BIN" "$NODE_BIN"; do
  echo "  $(realpath "$bin" 2>/dev/null || echo "$bin")"
done
