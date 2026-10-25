# mac-agent

Reads the open iPhone Safari tabs from the iCloud Tabs database on a Mac and posts them to the
Stash API on a schedule. It runs at login as a launchd user agent.

## Requirements

- macOS, signed in to iCloud with Safari tab sync on (the iPhone syncs its tabs to this Mac).
- Node >= 24 and pnpm (see the repo root).
- The Proton Pass CLI `pp`, logged in. It resolves the device token at start.
- A device API token for this Mac, stored in Proton Pass.

## Install

1. From the repo root, install dependencies:

   ```sh
   pnpm install
   ```

2. Create `apps/mac-agent/.env` (gitignored). It holds only a URL and a `pass://` reference,
   never the token itself:

   ```sh
   STASH_API_URL=https://stash.example.com
   STASH_DEVICE_TOKEN=pass://<vault>/<item>/<field>
   # Optional:
   # STASH_POLL_INTERVAL=5 minutes
   # STASH_CLOUD_TABS_DB=/path/to/CloudTabs.db
   # STASH_STATE_FILE=/path/to/state.json
   ```

   Check it resolves: `PROTON_PASS_AGENT_REASON="mac-agent check" pp run --env-file .env -- env | grep -c STASH_`
   (prints a count, not the values).

3. Install and start the agent:

   ```sh
   apps/mac-agent/install.sh
   ```

   It renders `launchd/com.stash.mac-agent.plist` into `~/Library/LaunchAgents`, loads it with
   `launchctl bootstrap gui/<uid>`, and prints the binaries that need Full Disk Access. Run it
   again after you move the repo, change Node, or change the env file. To see the plist without
   installing anything, run `apps/mac-agent/install.sh --print`.

   Override the detected paths with `NODE_BIN`, `PP_BIN`, `STASH_AGENT_ENV_FILE`,
   `STASH_AGENT_LOG_DIR` or `LAUNCH_AGENTS_DIR`.

## Full Disk Access

`CloudTabs.db` lives in Safari's container
(`~/Library/Containers/com.apple.Safari/Data/Library/Safari/`), which macOS protects. The agent
only opens it read-only, but it still needs Full Disk Access:

1. Open **System Settings → Privacy & Security → Full Disk Access**.
2. Click **+**, press **⌘⇧G**, and paste each path that `install.sh` printed (the real binaries
   of `pp` and `node`, with symlinks resolved, for example the Homebrew Cellar path for node).
3. Turn both switches on.
4. Restart the agent: `launchctl kickstart -k gui/$(id -u)/com.stash.mac-agent`.

After a Node upgrade the binary path changes. Grant access to the new binary and run
`install.sh` again.

## Logs

- `~/Library/Logs/stash-mac-agent/mac-agent.log` (stdout): one `Posted iCloud tabs` line per run.
- `~/Library/Logs/stash-mac-agent/mac-agent.err.log` (stderr): startup errors from `pp` or `node`.

```sh
tail -f ~/Library/Logs/stash-mac-agent/mac-agent.log
launchctl print gui/$(id -u)/com.stash.mac-agent   # state, last exit code, pid
```

The logs never contain the token. Delete them whenever you like.

## Uninstall

```sh
apps/mac-agent/uninstall.sh
```

It stops the agent and removes the plist. The logs and the device state file
(`~/Library/Application Support/stash-mac-agent/state.json`) stay. Delete them by hand if you
want a clean slate; without the state file the agent registers its devices again.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Operation not permitted` or `authorization denied` opening `CloudTabs.db` | Full Disk Access is missing for `pp` or `node`. See above, then kickstart. |
| `CloudTabs.db` not found | Turn on Safari in **System Settings → Apple Account → iCloud** and open Safari once. |
| No tabs from the iPhone | On the iPhone, turn on Safari in iCloud settings. Tabs show up after the next sync. |
| `pp` errors in `mac-agent.err.log` | `pp` is logged out or the reference is wrong. Test the `pp run` command from step 2. |
| A config error naming `STASH_API_URL` or `STASH_DEVICE_TOKEN` | The env file lacks the variable, or `STASH_AGENT_ENV_FILE` points at the wrong file. |
| `401` from the API | The device token was revoked or is wrong. Create a new one and update Proton Pass. |
| `launchctl bootstrap` fails with `Bootstrap failed: 5` | Run `uninstall.sh`, then `install.sh`. Check the plist with `plutil -lint ~/Library/LaunchAgents/com.stash.mac-agent.plist`. |
| The agent restarts in a loop | Read `mac-agent.err.log`. launchd restarts it at most once a minute. |
