# CLAUDE.md — packages/extension

Read the root [CLAUDE.md](../../CLAUDE.md) first. This file adds the rules for the extension context.
The deployable is `apps/extension` (see `apps/extension/CLAUDE.md`).

## Purpose

Features of the Zen / Firefox extension. Keep a later Safari Web Extension port possible.

| Package | Name | Contents |
|---|---|---|
| `capture/` | `@stash/ext-capture` | Hotkey saves the current tab, "Save all & close" for a window or Zen workspace |
| `tab-sync/` | `@stash/ext-tab-sync` | Periodic open-tab snapshots to the API |
| `device-commands/` | `@stash/ext-device-commands` | Poll and execute remote commands (for example close a tab) |
| `platform/` | `@stash/ext-platform` | `browser.*` services and the api client |

The prefix is `ext-`, not `extension-`.

## May depend on

- `@stash/contracts-*`: call the API through `HttpApiClient` from `@stash/contracts-api` (built in
  `@stash/ext-platform`), and use the schemas from `@stash/contracts-domain`.
- `@stash/ext-*`.
- `@stash/config-*` (dev tooling).
- Third-party packages from the catalog.

Never import `@stash/backend-*`, `@stash/mcp-*` or `@stash/web-*`. oxlint enforces this.

## tsconfig base

`@stash/config-tsconfig/extension.json`: ES2024 with DOM and `firefox-webext-browser` types. Add
`@types/firefox-webext-browser` (`catalog:`) to the package's devDependencies. If a package has
`.vue` files (an options page), follow the vue-tsc convention in
`packages/config/oxlint/README.md`.

## Platform

`@stash/ext-platform` is the only package that touches `browser`, `chrome`, `fetch` or other
runtime globals. It wraps `browser.tabs`, `browser.storage`, `browser.alarms`,
`browser.commands` and the toolbar button (`browser.browserAction` / `browser.action`) as Effect
services, provides the authenticated api client (per-device API
token), and exports in-memory layers as `./testing`. Differences between browsers, including the
future Safari port, live only here.

## Rules

- Features depend on platform services and never call `browser.*` directly.
- Background work is driven by alarms through the platform's `alarms` service, not by `setInterval`,
  because event pages get suspended.
- The API token comes from extension storage, set on the options page. Never hardcode it.

## Testing

Vitest with `@effect/vitest`. Provide the feature layer plus `@stash/ext-platform/testing` (fake
tabs, storage, alarms and api) with synthetic tabs and URLs, and assert on the calls and state.

## File naming

- `capture/src/save-current-tab.ts`, `capture/src/save-all-and-close.ts`
- `tab-sync/src/tabs-snapshot.ts`, `device-commands/src/commands-poller.ts`
- `platform/src/browser-tabs.ts`, `platform/src/testing.ts`
- `capture/test/save-current-tab.test.ts`
