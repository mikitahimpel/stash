# CLAUDE.md — apps/extension

Read the root [CLAUDE.md](../../CLAUDE.md) and [packages/extension/CLAUDE.md](../../packages/extension/CLAUDE.md) first.

## Purpose

The WXT shell of the Zen / Firefox extension: the manifest, the background entrypoint, the toolbar
popup, the options page (connecting the browser to Stash) and command bindings. It wires the features from
`packages/extension/*` to the live `@stash/ext-platform` layers. It holds no feature logic.

## May depend on

- `@stash/contracts-*`.
- `@stash/ext-*`.
- `@stash/config-*` (dev tooling).
- Third-party packages from the catalog (`wxt` and so on).

Never import `@stash/backend-*`, `@stash/mcp-*` or `@stash/web-*`. oxlint enforces this.

## tsconfig base

`@stash/config-tsconfig/extension.json`. If the options page uses `.vue` files, typecheck with
`vue-tsc` and `"typescript": "catalog:vue"`.

## Platform

`@stash/ext-platform`. Entrypoints provide its live layers. Even here, `browser.*` calls go through
platform services. WXT-generated code is the only exception.

## Rules

- Target Firefox/Zen first. Keep the manifest free of Chrome-only features so the Safari Web
  Extension conversion stays possible.
- The build knows its Stash. The web app's deploy sets `STASH_WEB_ORIGIN` for the build, and
  `wxt.config.ts` bakes it in (`build-origin.ts`). Never commit an address: a build without the
  variable has no built-in origin, and the options page asks for one.
- The options page gets the device token by pairing with the web app (`pair-extension.ts`: a
  one-time code, `/connect/extension?code=…`, then `pairings.claim`). The normal path is one
  button, **Connect to Stash**, with nothing to type. Another address sits behind "Use a different
  Stash", and the token by hand behind that. The token is stored with the platform `storage`
  service.
- The options page, like the popup, only shows state (`options-view.ts`) and calls its `actions`
  (`options-actions.ts`). It uses no default browser controls: every button and field takes the
  tactile classes of `assets/tokens.css`. Disconnecting asks first.
- A fresh install opens the options page (`firstRun` in `entrypoints/background.ts`).
- The toolbar popup (`entrypoints/popup/`) only shows state and calls its `actions`
  (`popup-actions.ts`, which run `@stash/ext-popup` effects). It pairs nothing itself: "Connect
  this browser" opens the options page, because a popup closes as soon as another tab opens.
- Removing a link is a hard delete. The popup never puts the focus on Undo or Remove, offers the
  one-click Undo only for a link its own Save just created (`created: true`), and asks before
  removing any other.
- Pages look like the web app. `assets/tokens.css` is a copy of the web design tokens
  (`packages/web/ui/src/styles.css`); keep the values in step by hand, never import `@stash/web-*`.
  Light and dark follow `prefers-color-scheme`.
- The logo is the Well mark ("Logo" in [docs/design.md](../../docs/design.md#logo)).
  `assets/stash-mark.svg` and `assets/stash-mark-sm.svg` are copies of the web kit's, kept in step
  by hand. `scripts/icons.ts` draws `public/icon/<size>.png` from them (16 and 32 from the small
  mark), and `wxt.config.ts` lists those as `icons` and the toolbar's `default_icon`. Never export
  an icon by hand.

## Testing

Minimal wiring tests: entrypoints build their layers with `@stash/ext-platform/testing`. Feature
behavior is tested in `packages/extension/*`. The popup page has one page test for what only the
page decides: the focus and the confirmation before a delete. The options page has one too
(one button and no field in the normal path, the confirmation before a disconnect), and
`test/options-actions.test.ts` walks the pairing round trip on the in-memory platform.

## File naming

- `wxt.config.ts`, `entrypoints/background.ts`, `entrypoints/options/index.html`,
  `entrypoints/options/main.ts`, `entrypoints/options/options-page.vue` (WXT dictates the
  `entrypoints/` layout). In a directory entrypoint only `index.html` is the entry, so the options
  page logic sits beside it: `entrypoints/options/save-config.ts`,
  `entrypoints/options/pair-extension.ts`, `entrypoints/options/options-view.ts`,
  `entrypoints/options/options-actions.ts`. `build-origin.ts` is at the app root, because
  `wxt.config.ts` and the options page both import it. The "Save all & close"
  confirmation popup is `entrypoints/save-all-and-close/` (`index.html`, `main.ts`,
  `save-all-and-close-page.vue`).
- The toolbar popup is `entrypoints/popup/` (`index.html`, `main.ts`, `popup-page.vue`,
  `popup-actions.ts`). `preview/popup/` mounts the same page over made-up states for the
  screenshots; it is not an entrypoint and is not in the build. `preview/options/` does the same
  for the options page.
- `test/background.test.ts`, `test/save-config.test.ts`, `test/build-origin.test.ts`,
  `test/options-actions.test.ts`, `test/options-page.test.ts`, `test/popup-actions.test.ts`,
  `test/popup-page.test.ts` (mounts the page in happy-dom over fake `actions`: where the focus goes,
  and that removing a link takes a deliberate click)

## Commands

`build` (Firefox zip in `.output/`), `package:xpi <out.xpi>` (the `.xpi` the web app serves,
signed when the AMO key is in env, `scripts/package-xpi.ts`), `icons` (the toolbar and add-on icons into `public/icon/`, `scripts/icons.ts`), `screenshots` (the popup in both
themes into `docs/screenshots/extension-popup-*.png`, `scripts/popup-screenshots.ts`),
`screenshots:options` (the options page, `docs/screenshots/extension-options-*.png`,
`scripts/options-screenshots.ts`) and `dev`
(WXT dev server on `0.0.0.0`). See [README.md](README.md).

## WXT notes

- Auto-imports are off (`imports: false`), and a `config:resolved` hook also turns off unimport's
  rewriting, which otherwise turns `browser.*` in `@stash/ext-platform` into an unresolvable
  `wxt/browser` import. Import `defineBackground` and friends from `wxt/utils/*`.
- `.output/` and `.wxt/` are generated and gitignored.
