# CLAUDE.md — apps/extension

Read the root [CLAUDE.md](../../CLAUDE.md) and [packages/extension/CLAUDE.md](../../packages/extension/CLAUDE.md) first.

## Purpose

The WXT shell of the Zen / Firefox extension: the manifest, the background entrypoint, the options
page (API URL and device token) and command bindings. It wires the features from
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
- The device token is entered on the options page and stored with the platform `storage` service.

## Testing

Minimal wiring tests: entrypoints build their layers with `@stash/ext-platform/testing`. Feature
behavior is tested in `packages/extension/*`.

## File naming

- `wxt.config.ts`, `entrypoints/background.ts`, `entrypoints/options/index.html`,
  `entrypoints/options/main.ts`, `entrypoints/options/options-page.vue` (WXT dictates the
  `entrypoints/` layout). In a directory entrypoint only `index.html` is the entry, so the options
  page logic sits beside it: `entrypoints/options/save-config.ts`.
- `test/background.test.ts`, `test/save-config.test.ts`

## Commands

`build` (Firefox zip in `.output/`) and `dev` (WXT dev server on `0.0.0.0`). See
[README.md](README.md).

## WXT notes

- Auto-imports are off (`imports: false`), and a `config:resolved` hook also turns off unimport's
  rewriting, which otherwise turns `browser.*` in `@stash/ext-platform` into an unresolvable
  `wxt/browser` import. Import `defineBackground` and friends from `wxt/utils/*`.
- `.output/` and `.wxt/` are generated and gitignored.
