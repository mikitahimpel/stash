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
- The API base URL comes from Vite env (`import.meta.env`), never hardcoded.
- Adding a page means adding a route export in a feature package and mounting it here: in
  `src/app-router.ts`, replace the feature's placeholder from `src/placeholder-routes.ts` with
  `import { routes } from "@stash/web-<feature>/routes"`. Keep the route names (`links`,
  `search`, `open-tabs`, `settings`), because the layout nav links to them.

## Testing

Minimal: the router resolves the feature routes, and the auth guard redirects when logged out.
Feature behavior is tested in `packages/web/*`.

## File naming

- `src/main.ts`, `src/app-router.ts`, `src/app-layout.vue`
- `src/app-theme.ts` (theme atoms over `@stash/web-platform/theme`; `main.ts` mounts its state, which
  applies the stored theme as the app starts)
- `src/ui-gallery-page.vue`: the dev-only `/_ui` page (`devRoutes` in `app-router.ts`, public,
  dropped from the production build) showing every `@stash/web-ui` primitive with a theme switch
- `src/app-registry.ts` (the atom registry with the live layers), `src/placeholder-routes.ts` and
  `src/placeholder-page.vue` (stand-ins until each feature package exports its `./routes`)
- `vite.config.ts`, `public/manifest.webmanifest`, `public/icons/*`
