# @stash/extension

The Zen / Firefox extension, built with [WXT](https://wxt.dev). See [CLAUDE.md](CLAUDE.md) for the
rules of this app.

## Install

The web app serves the extension at `/downloads/stash-extension.xpi`, and its **Connect** page
(Zen / Firefox) links to it. Open the link in Zen or Firefox and confirm the install.

Zen and release Firefox install only add-ons signed by Mozilla. `xpinstall.signatures.required`
is honoured only in Firefox Developer Edition, Nightly and ESR, so Zen ignores it. The deploy
therefore signs the `.xpi` as an **unlisted** add-on on addons.mozilla.org (AMO). Unlisted means
self-distributed: it has no public listing, and AMO signs it automatically. Signing needs the AMO API
key in env (`WEB_EXT_API_KEY`, `WEB_EXT_API_SECRET` from the `AMO` item in the `Stash` vault,
see `.env.example`). Without it the deploy serves an unsigned `.xpi`, which installs only in
Developer Edition or Nightly with `xpinstall.signatures.required` set to `false`. In Zen, load it
temporarily instead: `about:debugging` → "This Firefox" → "Load Temporary Add-on…".

## Build

```sh
pnpm --filter @stash/extension build   # → apps/extension/.output/stash-<version>-firefox.zip
pnpm --filter @stash/extension package:xpi -- <out.xpi>   # what the deploy runs
```

WXT builds Firefox as Manifest V2 (its default for Firefox). The unpacked build is in
`.output/firefox-mv2/`. `package:xpi` (`scripts/package-xpi.ts`) zips it, or signs it with
`web-ext sign --channel unlisted` when the AMO key is set. AMO signs each version only once, so a
signed build gets a dated version (`1.<YYYYMMDD>.<minute>`). The signed file is cached in
`.output/signed/` under a hash of the build, so an unchanged extension is not signed again.

## Develop

```sh
pnpm --filter @stash/extension dev
```

This builds `.output/firefox-mv2-dev/` and starts WXT's dev server on `0.0.0.0:3000`, rebuilding
on every change. WXT opens Firefox with the extension when `web-ext` can start a browser. On WSL or a
remote host it can't: load the extension by hand in Firefox or Zen at `about:debugging` →
"This Firefox" → "Load Temporary Add-on…", and pick `.output/firefox-mv2-dev/manifest.json`.

## Setup

Open the extension's options page (`about:addons` → Stash → Preferences), enter your Stash address
and click **Connect**. A Stash tab opens (sign in if asked) and asks to connect this browser.
Approve it, and the options page gets its own device token: there is nothing to copy. Under the
hood the page makes a one-time code, the web app binds it to a new Zen device
(`POST /pairings`), and the options page claims the token with the code (`POST /pairings/claim`,
polled every 2 seconds for up to 15 minutes).

**Advanced** on the same page still takes an API URL (`https://<stash>/api`) and a device token
by hand. It checks them with `GET /auth/me` and keeps the previous settings if the API rejects
them.

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
