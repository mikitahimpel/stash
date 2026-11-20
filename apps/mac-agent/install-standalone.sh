#!/usr/bin/env bash
# Installs mac-agent on a Mac without a checkout: the web app serves this script and the bundled
# agent (`/downloads/install-mac-agent.sh`, `/downloads/stash-mac-agent.mjs`). The Connect page
# prints the one command to run, with the address and a fresh device token filled in:
#
#   curl -fsSL https://<stash>/downloads/install-mac-agent.sh | STASH_URL=https://<stash> STASH_DEVICE_TOKEN=<token> bash
#
# Without STASH_DEVICE_TOKEN it asks for the token in the terminal, hidden (`read -rs`), so the
# token stays out of the shell history:
#
#   curl -fsSL https://<stash>/downloads/install-mac-agent.sh | STASH_URL=https://<stash> bash
#
# It downloads the agent to ~/Library/Application Support/stash-mac-agent/, writes a launchd user
# agent that runs it with Node at login, and starts it. The token goes into that plist, readable
# only by you (mode 600). Stop and remove it with:
#
#   curl -fsSL https://<stash>/downloads/install-mac-agent.sh | bash -s -- --uninstall
#
#   --print      only print the plist (works on any OS, touches nothing)
#   --uninstall  stop the agent and remove the plist and the agent (logs and state stay)
#
# Env: STASH_URL (the web app's address), STASH_DEVICE_TOKEN, and optionally NODE_BIN,
# STASH_AGENT_HOME, STASH_AGENT_LOG_DIR, LAUNCH_AGENTS_DIR, STASH_TOKEN_TTY (where the prompt reads
# the token from, /dev/tty by default: stdin is this script when piped from curl).
set -euo pipefail

LABEL="com.stash.mac-agent"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
AGENT_HOME="${STASH_AGENT_HOME:-$HOME/Library/Application Support/stash-mac-agent}"
LOG_DIR="${STASH_AGENT_LOG_DIR:-$HOME/Library/Logs/stash-mac-agent}"
LAUNCH_AGENTS_DIR="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
AGENT="$AGENT_HOME/stash-mac-agent.mjs"
TARGET="$LAUNCH_AGENTS_DIR/$LABEL.plist"
STASH_URL="${STASH_URL:-}"
STASH_URL="${STASH_URL%/}"

die() {
  echo "stash mac-agent: $*" >&2
  exit 1
}

# Escapes a value for an XML text node.
xml() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

render() {
  local path
  path="$(dirname "$NODE_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE_BIN")</string>
    <string>$(xml "$AGENT")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml "$AGENT_HOME")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml "$path")</string>
    <key>STASH_API_URL</key>
    <string>$(xml "$STASH_URL/api")</string>
    <key>STASH_DEVICE_TOKEN</key>
    <string>$(xml "$STASH_DEVICE_TOKEN")</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>60</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$(xml "$LOG_DIR/mac-agent.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$LOG_DIR/mac-agent.err.log")</string>
</dict>
</plist>
PLIST
}

case "${1:-}" in
  --uninstall)
    [[ "$(uname -s)" == "Darwin" ]] || die "launchd needs macOS"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$TARGET" "$AGENT"
    echo "Stopped and removed the Stash mac-agent. Logs stay in $LOG_DIR."
    exit 0
    ;;
  --print | "") ;;
  *) die "unknown argument: $1 (use --print or --uninstall)" ;;
esac

[[ -n "$NODE_BIN" ]] || die "Node.js not found. Install Node 24 or newer (brew install node), then run this again."
[[ "$STASH_URL" =~ ^https?:// ]] || die "set STASH_URL to your Stash address, for example https://stash.example.com"
if [[ -z "${STASH_DEVICE_TOKEN:-}" ]]; then
  tty="${STASH_TOKEN_TTY:-/dev/tty}"
  if { exec 3<"$tty"; } 2>/dev/null; then
    printf 'Paste the device token from the Connect page (hidden), then press Return: ' >&2
    IFS= read -rs STASH_DEVICE_TOKEN <&3 || true
    exec 3<&-
    echo >&2
  fi
fi
[[ -n "${STASH_DEVICE_TOKEN:-}" ]] || die "set STASH_DEVICE_TOKEN (create one on the Connect page)"

if [[ "${1:-}" == "--print" ]]; then
  render
  exit 0
fi

[[ "$(uname -s)" == "Darwin" ]] || die "launchd needs macOS; use --print to only render the plist"
major="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[[ "$major" -ge 24 ]] || die "Node $major is too old. Install Node 24 or newer (brew install node)."

mkdir -p "$AGENT_HOME" "$LOG_DIR" "$LAUNCH_AGENTS_DIR"
curl -fsSL "$STASH_URL/downloads/stash-mac-agent.mjs" -o "$AGENT.download"
mv "$AGENT.download" "$AGENT"

umask 077
render >"$TARGET"
chmod 600 "$TARGET"
plutil -lint "$TARGET" >/dev/null || die "the rendered plist is invalid: $TARGET"

# Reinstall: drop a loaded copy first, bootstrap fails if the label is already loaded.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"

node_real="$(realpath "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")"
cat <<DONE
The Stash mac-agent is running. It posts your iPhone's Safari tabs whenever they change.

One more step: give Node Full Disk Access, so it can read Safari's iCloud Tabs.
  1. Open System Settings → Privacy & Security → Full Disk Access.
  2. Click +, press ⌘⇧G and paste: $node_real
  3. Turn it on, then restart the agent:
     launchctl kickstart -k gui/$(id -u)/$LABEL

Logs: $LOG_DIR/mac-agent.log
DONE
