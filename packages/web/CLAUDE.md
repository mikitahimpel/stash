# CLAUDE.md — packages/web

Read the root [CLAUDE.md](../../CLAUDE.md) first. This file adds the rules for the web context.
The deployable is `apps/web` (see `apps/web/CLAUDE.md`).

## Purpose

Features and UI for the Vue 3 web app: search, feeds, the "Open now" tab view and settings. The
app can be installed to the iPhone home screen.

| Package | Name | Contents |
|---|---|---|
| `links/` | `@stash/web-links` | Feeds (recent, not yet seen), tag and type filters, status actions |
| `search/` | `@stash/web-search` | Search page (semantic and keyword) |
| `open-tabs/` | `@stash/web-open-tabs` | "Open now" view across devices (open, archive, close on device) |
| `settings/` | `@stash/web-settings` | Devices and API tokens |
| `ui/` | `@stash/web-ui` | Tailwind and shadcn-vue base components |
| `api-client/` | `@stash/web-api-client` | `HttpApiClient` from contracts, plus shared atoms (`@effect/atom-vue`) |
| `platform/` | `@stash/web-platform` | Web APIs as Effect services |

## May depend on

- `@stash/contracts-*`: types and schemas from `@stash/contracts-domain`. The API itself is called
  only through `@stash/web-api-client`.
- `@stash/web-*`.
- `@stash/config-*` (dev tooling).
- Third-party packages from the catalog: `vue`, `vue-router`, `@effect/atom-vue`,
  `@effect/platform-browser` and so on.

Never import `@stash/backend-*`, `@stash/mcp-*` or `@stash/ext-*`. oxlint enforces this.

## tsconfig base

`@stash/config-tsconfig/web.json`: ES2024 with DOM, `jsx: preserve`, `jsxImportSource: vue`, and
`vueCompilerOptions.strictTemplates`. A package with `.vue` files typechecks with
`vue-tsc --noEmit -p tsconfig.json` and takes `"typescript": "catalog:vue"` (TypeScript 6), because
vue-tsc can't run on TypeScript 7. See `packages/config/oxlint/README.md`. A package without
`.vue` files uses `tsc` and `catalog:`.

## Platform

`@stash/web-platform` is the only package that touches `window`, `document`, `localStorage`,
`sessionStorage`, `indexedDB`, `navigator` or `fetch` (`.vue` templates are exempt). It reuses
`@effect/platform-browser` (`BrowserKeyValueStore`, `IndexedDb`, `Clipboard`, `Permissions`,
`BrowserHttpClient`), adds its own services (`share`, `network`, `visibility`), and exports
in-memory layers as `./testing`. Features depend on the services, and `apps/web` provides the live
layers.

## Rules

- State lives in atoms (`@effect/atom-vue`) that wrap Effect programs. Components stay thin: they
  read atoms and call actions.
- Each feature exports its routes (`./routes`) and the components other features may use.
  `apps/web` mounts the routes.
- Shared visual components go in `@stash/web-ui`. Feature-specific components stay in the feature.
- Component files are kebab-case too: `link-card.vue`, used as `<LinkCard />`.

## Testing

Vitest. Test logic (atoms, actions, data shaping) through Layers, using
`@stash/web-platform/testing` and a fake api client. Write component tests only for real UI
behavior (interaction, conditional rendering), not for markup snapshots.

## File naming

- `links/src/links-list-page.vue`, `links/src/link-card.vue`, `links/src/links-atoms.ts`,
  `links/src/routes.ts`
- `links/src/details/link-details-page.vue`, `links/src/details/link-details-atoms.ts` (after a
  feature grows past about 5–7 files)
- `platform/src/share.ts`, `platform/src/testing.ts`
- `links/test/links-atoms.test.ts`
