# @stash/extension

The Zen / Firefox extension, built with [WXT](https://wxt.dev). See [CLAUDE.md](CLAUDE.md) for the
rules of this app.

## Build

```sh
pnpm --filter @stash/extension build   # → apps/extension/.output/stash-<version>-firefox.zip
```

WXT builds Firefox as Manifest V2 (its default for Firefox). The unpacked build is in
`.output/firefox-mv2/`.

## Develop

```sh
pnpm --filter @stash/extension dev
```

This builds `.output/firefox-mv2-dev/` and starts WXT's dev server on `0.0.0.0:3000`, rebuilding
on every change. WXT opens Firefox with the extension when `web-ext` can start a browser. On WSL or a
remote host it can't: load the extension by hand in Firefox or Zen at `about:debugging` →
"This Firefox" → "Load Temporary Add-on…", and pick `.output/firefox-mv2-dev/manifest.json`.

## Setup

Open the extension's options page (`about:addons` → Stash → Preferences), enter the API URL and the
device token, and save. The page checks them with `GET /auth/me` and keeps the previous settings if
the API rejects them.

Once a device token is saved, the background page polls `GET /devices/:id/commands?status=pending`
every minute (and on start), runs each command (`close-tab` closes every tab with that URL) and
acks it `done` or `failed`. The device id comes from `GET /auth/me`.

## Use

Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> (change it at `about:addons` → ⚙ → "Manage
Extension Shortcuts") or click the Stash toolbar button to save the current tab. The badge shows
the result for a few seconds: `✓` saved, `wait` rate limited, `off` API unreachable, `!` not
saved (hover for the reason). Rate-limited and offline saves, and saves made before the device
token is set, are queued in extension storage and sent again later.

Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd> to save every tab of the window (in Zen, the
visible tabs, which are the current workspace) and close them. A small popup lists what will be
saved and asks first. Pinned tabs and pages that are not http(s) are skipped and stay open. The
tabs are sent with `POST /links/batch`, and only the tabs whose links come back saved are closed;
the rest stay open, so pressing the hotkey again retries them. If nothing would be left, a blank
tab is opened so the window stays.
