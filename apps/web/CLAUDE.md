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
- The API base URL comes from Vite env (`import.meta.env`), never hardcoded.
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
  nav, sync status, search, theme toggle, sign out)
- The theme atoms live in `@stash/web-settings/theme-atoms`, shared by the header toggle and the
  Settings Appearance section so both drive one `Theme` service. `app-registry.ts` provides its
  layer, and `main.ts` mounts its state, which applies the stored theme as the app starts.
- `src/ui-gallery-page.vue`: the dev-only `/_ui` page (`devRoutes` in `app-router.ts`, public,
  dropped from the production build) showing every `@stash/web-ui` primitive with a theme switch
- `src/app-network.ts` (the sync status over `@stash/web-platform/network`) and
  `src/app-shortcuts.ts` (⌘K and `/` over `@stash/web-platform/keyboard`)
- `src/app-registry.ts` (the atom registry with the live layers)
- `vite.config.ts`, `public/manifest.webmanifest`, `public/icons/*`
