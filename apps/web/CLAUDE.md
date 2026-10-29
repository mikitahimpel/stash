# CLAUDE.md — apps/web

Read the root [CLAUDE.md](../../CLAUDE.md) and [packages/web/CLAUDE.md](../../packages/web/CLAUDE.md) first.

## Purpose

The Vue 3 SPA shell: Vite config, router, layout and the PWA manifest. It is served as Workers
Static Assets. It mounts the routes exported by `packages/web/*` (including the login route) and
provides the live layers. `src/app-router.ts` installs the auth guard from `@stash/web-auth`. It
holds no feature logic.

## May depend on

- `@stash/contracts-*`.
- `@stash/web-*`.
- `@stash/config-*` (dev tooling).
- Third-party packages from the catalog (`vue`, `vue-router`, `vite`, Tailwind and so on).

Never import `@stash/backend-*`, `@stash/mcp-*` or `@stash/ext-*`. oxlint enforces this.

## tsconfig base

`@stash/config-tsconfig/web.json`. It typechecks with `vue-tsc` and `"typescript": "catalog:vue"`.

## Platform

`@stash/web-platform`. `src/main.ts` provides its live layers (and the live api client from
`@stash/web-api-client`) to the app. Runtime globals stay inside `@stash/web-platform`, and the
app shell doesn't use them either.

## Rules

- Dev server: `vite --host 0.0.0.0` so it opens from other machines.
- Vite blocks requests whose `Host` header isn't on its allowlist. To open the dev or preview
  server by hostname (for example a Tailscale name), list the extra hosts in
  `STASH_DEV_ALLOWED_HOSTS` (comma-separated): `STASH_DEV_ALLOWED_HOSTS=myhost pnpm dev:web`.
  `vite.config.ts` reads it into `server.allowedHosts` and `preview.allowedHosts`. Unset keeps
  Vite's default. Never hardcode machine names.
- The api is same-origin under `/api` (see [docs/deploy.md](../../docs/deploy.md#same-origin-api)).
  `src/web-worker.ts` is the `Web` Worker: it runs only for `/api` and `/api/*` and forwards them to
  the api through the `API` Service Binding with the prefix stripped. A Workers entry may export
  only handlers, so it exports nothing but `default` and types. The SPA's api base URL defaults to
  `/api` (`@stash/web-api-client/api-base-url`) and `VITE_API_BASE_URL` overrides it, never a
  hardcoded URL. The Vite dev and preview servers proxy `/api` to `STASH_DEV_API_URL` (default
  `http://localhost:8787`, `alchemy dev`).
- `scripts/live-session-check.ts` (`pnpm --filter @stash/web check:live`): the scripted check of a
  deployed web origin (same-origin api, no `stash-api.` in the bundle, session cookie round-trip),
  see [docs/deploy.md](../../docs/deploy.md#check-a-deploy).
- Adding a page means adding a route export in a feature package and mounting it here, in
  `featureRoutes` of `src/app-router.ts`. Keep the route names (`links`, `search`, `open-tabs`,
  `settings`), because the header nav links to them.
- Shortcuts: ⌘K / Ctrl+K opens the search page and `/` focuses the current page's field. Both
  focus the first `main input[type=search]` (`AppShortcuts.pageSearchField`), so a page marks its
  search or filter field by making it a search input (`<SearchField />` from `@stash/web-ui`).
  The Inbox keys (↑/↓, ↵, S, D, E) live in `@stash/web-links/inbox-shortcuts`; `src/app-registry.ts`
  gives its `keyboard` atom the same live layer.

## Testing

Minimal: the router resolves the feature routes, and the auth guard redirects when logged out.
Feature behavior is tested in `packages/web/*`.

## File naming

- `src/main.ts`, `src/app-router.ts`, `src/app-layout.vue`, `src/app-header.vue` (wordmark,
  nav, and one right cluster: sync status, search, theme menu, account menu from
  `@stash/web-auth/account-menu`). On phones the nav is a bottom bar. See "Layout rules" in
  [docs/design.md](../../docs/design.md).
- `src/styles.css`: imports the kit's styles and lists every `@stash/web-*` feature package with
  templates under `@source`, or Tailwind drops the classes only that package uses.
  `test/styles.test.ts` checks the list against `dependencies`.
- `scripts/screenshots.ts` (`pnpm --filter @stash/web screenshots`): boots `alchemy dev` and Vite,
  seeds synthetic data and a session, and writes every page in both themes at 1440 and 390 wide to
  `docs/screenshots/`. It fails on horizontal scroll or a button without an accessible name.
  Commit the PNGs with any visual change.
- The theme atoms live in `@stash/web-settings/theme-atoms`, shared by the header theme menu and the
  Settings Appearance section so both drive one `Theme` service. `app-registry.ts` provides its
  layer, and `main.ts` mounts its state, which applies the stored theme as the app starts.
- `src/ui-gallery-page.vue`: the dev-only `/_ui` page (`devRoutes` in `app-router.ts`, public,
  dropped from the production build) showing every `@stash/web-ui` primitive with a theme switch
- `src/app-network.ts` (the sync status over `@stash/web-platform/network`) and
  `src/app-shortcuts.ts` (⌘K and `/` over `@stash/web-platform/keyboard`)
- `src/app-registry.ts` (the atom registry with the live layers)
- `src/web-worker.ts` (the `Web` Worker entry, see Rules)
- `vite.config.ts`, `public/manifest.webmanifest`, `public/icons/*`
