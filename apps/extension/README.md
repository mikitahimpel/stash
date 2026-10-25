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
