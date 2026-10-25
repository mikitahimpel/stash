#!/usr/bin/env bash
# Stops mac-agent and removes its launchd plist. Logs and the device state file are kept.
#
# Overrides (env):
#   LAUNCH_AGENTS_DIR  where install.sh put the plist (default: ~/Library/LaunchAgents)
set -euo pipefail

LABEL="com.stash.mac-agent"
LAUNCH_AGENTS_DIR="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
TARGET="$LAUNCH_AGENTS_DIR/$LABEL.plist"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "uninstall.sh: launchd needs macOS" >&2
  exit 1
fi

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$TARGET"
echo "Removed $LABEL."
