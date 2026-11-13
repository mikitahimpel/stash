# CLAUDE.md — packages/web

Read the root [CLAUDE.md](../../CLAUDE.md) first. This file adds the rules for the web context.
The deployable is `apps/web` (see `apps/web/CLAUDE.md`).

## Purpose

Features and UI for the Vue 3 web app: search, feeds, the "Open now" tab view and settings. The
app can be installed to the iPhone home screen.

| Package | Name | Contents |
|---|---|---|
| `links/` | `@stash/web-links` | Inbox: Save a link field, feeds (not yet seen, recent, all), 30-day saved/read chart, tag and type filters, status actions and keys |
| `search/` | `@stash/web-search` | Search page (semantic and keyword) |
| `open-tabs/` | `@stash/web-open-tabs` | "Open now" view across devices (open, archive, close on device) |
| `settings/` | `@stash/web-settings` | Appearance (theme atoms, also used by the app header), devices and API tokens, first-run onboarding card (used by Inbox and Open now) |
| `auth/` | `@stash/web-auth` | Login page, `me` atom, auth guard, account menu (a slot for the app's entries, Sign out) |
| `ui/` | `@stash/web-ui` | "Stash tactile" design system ([docs/design.md](../../docs/design.md)): control tokens, Geist, primitives, app shell |
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
`BrowserHttpClient`), adds its own services (`share`, `network`, `visibility`, `theme`, `keyboard`), and exports
in-memory layers as `./testing`. Features depend on the services, and `apps/web` provides the live
layers.

## Rules

- State lives in atoms (`@effect/atom-vue`) that wrap Effect programs. Components stay thin: they
  read atoms and call actions.
- Each feature exports its routes (`./routes`) and the components other features may use.
  `apps/web` mounts the routes.
- Api queries (`ApiAtoms.query`, `ApiAtoms.pages`) are cached and revalidated: they outlive the
  page that reads them, so a page opened again shows its data at once and refreshes it in the
  background. Pages show a skeleton only on a first load that takes over 200 ms
  (`useDelayedLoading` from `@stash/web-ui/use-delayed-loading`), and a failed load with nothing
  cached as `<ErrorState>` (`@stash/web-ui/error-state`) with a Retry that refreshes the atom.
- Any 401 from the api sends the user to the login page, which returns to the page they wanted
  (`@stash/web-auth/auth-guard`). Pages don't handle `Unauthorized` themselves.
- A page starts with `<PageHeader>` (title, one muted line, its primary action on the right) and
  uses the spacing scale and control hierarchy from [docs/design.md](../../docs/design.md) ("Layout
  rules"). At most one `primary` key per screen.
- Shared visual components go in `@stash/web-ui`. Feature-specific components stay in the feature.
- **Feature code doesn't style controls or rows.** In `links`, `search`, `open-tabs`, `settings`,
  `auth` (and `apps/web`), templates use layout utilities only: `flex`, `grid`, `gap-*` on the
  spacing scale, `w-*` / `min-w-*` / `max-w-*`, `overflow-*`, `truncate`, `hidden` / `sm:` visibility,
  plus the kit's text roles and colors (`text-meta`, `text-body`, `text-label`,
  `text-muted-foreground`, `text-signal`, …) and SVG `fill-*` / `stroke-*` in charts. No `h-*`,
  padding, margins (except `*-auto`), `rounded-*`, `border-*`, `bg-*`, `font-*`, `text-xs|sm|[..]`
  or `tactile-*`. Every control and row comes from `@stash/web-ui` at a kit size (`sm` 32, `md` 36,
  `lg` 44); row actions are `ghost` `sm`, lists are `ListRow` with its slots. Need a look the kit
  lacks? Add it to the kit. `apps/web/test/feature-classes.test.ts` enforces this, and the layout
  audit (`pnpm --filter @stash/web audit:layout`, see [docs/design.md](../../docs/design.md#layout-audit))
  checks the rendered pages.
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
