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
  `featureRoutes` of `src/app-router.ts`. Keep the route names (`links`, `open-tabs`,
  `settings`), because the header nav links to them; `search` and `connect` are the redirects
  below.
- Shortcuts: ⌘K / Ctrl+K and `/` focus the search field in the header
  (`AppShortcuts.searchField`, `header input[type=search]`), on any page, without navigating.
  The Inbox keys (↑/↓, ↵, S, D, E) live in `@stash/web-links/inbox-shortcuts`; `src/app-registry.ts`
  gives its `keyboard` atom the same live layer.
- `/search?q=…` and `/connect[?guide=…]` are redirects (to `/links?q=…` and
  `/settings?guide=…#connections`), kept for the extension, the docs and old links. The router's
  `scrollBehavior` scrolls to an anchor, clear of the sticky header.

## Testing

Minimal: the router resolves the feature routes, and the auth guard redirects when logged out.
Feature behavior is tested in `packages/web/*`.

## File naming

- `src/main.ts`, `src/app-router.ts`, `src/app-layout.vue` (the kit's `AppFrame` and `AppMain`),
  `src/app-header.vue` (the kit's `AppBar`: the logo,
  nav as text tabs (Inbox, Open now, Settings), the compact search field (`@stash/web-search/search-box`
  in `AppBarSearch`, the only search entry point; 300px, 480px while focused) and the account menu from
  `@stash/web-auth/account-menu`, which holds the theme switch and the sync status). On phones the
  nav is a bottom bar and the search field a full-width line under the header row. See "Layout rules" in
  [docs/design.md](../../docs/design.md).
- `src/styles.css`: imports the kit's styles and lists every `@stash/web-*` feature package with
  templates under `@source`, or Tailwind drops the classes only that package uses.
  `test/styles.test.ts` checks the list against `dependencies`.
- `scripts/screenshots.ts` (`pnpm --filter @stash/web screenshots`): boots `alchemy dev` and Vite,
  seeds synthetic data and a session, and writes every page in both themes at 1440 and 390 wide to
  `docs/screenshots/`, seeded and with no data (`*-empty-*.png`). It fails on horizontal scroll or a button without an accessible name.
  Commit the PNGs with any visual change.
- `scripts/layout-audit.ts` (`pnpm --filter @stash/web audit:layout`, CI job `layout-audit`):
  builds the app, serves it with `vite preview` and checks every page (seeded and empty, desktop
  and phone) against the control tokens, content edges and spacing scale; see "Layout audit" in
  [docs/design.md](../../docs/design.md#layout-audit). Its rules are `scripts/layout-audit-rules.ts`
  (unit tested), its in-page measuring `scripts/layout-audit-probe.ts`, and its synthetic api
  `scripts/layout-fixtures.ts`. `scripts/preview-images.ts` draws the fixtures' preview images
  (SVG); the audit and the screenshots answer `https://example.com/previews/*` with them in the
  browser, so no real thumbnail is in the repo and nothing is fetched. It also draws the favicons of the fixtures' tab sites
  (`faviconShim` explains why they are asked for as `/favicon.ico?drawn`). Both it and the Connect walk serve the build with
  `scripts/preview-server.ts`.
- `scripts/brand-icons.ts` (`pnpm --filter @stash/web icons`): draws `public/favicon.svg`, the
  favicon PNGs, the `apple-touch-icon` and the manifest icons from the kit's logo SVGs, and
  `docs/screenshots/brand-icons.png`; see "Logo" in [docs/design.md](../../docs/design.md#logo).
  Never export an icon by hand. `test/brand-icons.test.ts` checks the sizes and the opaque icons.
- `scripts/build-memo.ts`: the inputs of the build as the `memo.include` globs of the `Web`
  resource, the one module this app exports (`@stash/web/build-memo`, for `alchemy.run.ts`). A
  `../` glob is not filtered by `.gitignore`, so each one names real inputs and never a whole app
  (`../extension/**` walks `node_modules`). `test/build-memo.test.ts` checks it. Add a glob here
  when `build:deploy` starts to read a new place.
- `scripts/tab-switch.ts` (`pnpm --filter @stash/web check:tab-switch`, after a build; the same
  CI job): clicks through the header tabs on the built app with an api that answers after 300 ms,
  and fails when a switch to a visited tab takes over 100 ms from the click to the painted rows,
  shows a skeleton, doesn't refresh behind, or loses the tab's scroll position; also when a first
  visit doesn't show its layout at once or a hovered tab doesn't open with its rows. A walk with a
  problem is repeated twice (a busy machine makes single frames late). `STASH_SWITCH_CPU`,
  `STASH_SWITCH_NETWORK=slow`, `STASH_SWITCH_API_DELAY` and `STASH_SWITCH_PROFILE=<dir>` turn it
  into a measurement. Its in-page timing is `scripts/tab-switch-probe.ts`.
- `scripts/loading-states.ts` (`pnpm --filter @stash/web check:loading`, after a build; the same
  CI job): the skeletons' boxes against the loaded content and the Cumulative Layout Shift of
  each page with a slow api, see "Loading states" in [docs/design.md](../../docs/design.md).
  `--screenshots` writes `docs/screenshots/loading-*.png`. Its in-page measuring is
  `scripts/loading-states-probe.ts`.
- `scripts/connect-walk.ts` (`pnpm --filter @stash/web walk:connect`, after a build; the same CI
  job runs it after the audit): walks each Connect guide (in Settings; the iPhone one through the old `/connect?guide=` address),
  the extension approve page, `/search?q=` and `/save`
  in headless Chromium, one page at a time, against `Fixtures.connectable` (the seeded api plus
  the writes the guides make). Each guide creates its device or token, shows the prefilled values
  and turns to "Connected ✓" once the fixture reports the first save, check-in or use.
- `test/feature-classes.test.ts`: scans the templates of `apps/web` and the feature packages for
  classes that style controls or rows (see `packages/web/CLAUDE.md`, "Rules").
- The theme atoms live in `@stash/web-settings/theme-atoms`, shared by the account menu's theme switch and
  the Settings Appearance section so both drive one `Theme` service. `app-registry.ts` provides its
  layer, and `main.ts` mounts its state, which applies the stored theme as the app starts.
- `src/ui-gallery-page.vue`: the dev-only `/_ui` page (`devRoutes` in `app-router.ts`, public,
  dropped from the production build) showing every `@stash/web-ui` primitive in every size, side
  by side in a grid, with a theme switch
- `src/app-network.ts` (the sync status over `@stash/web-platform/network`) and
  `src/app-shortcuts.ts` (⌘K and `/` over `@stash/web-platform/keyboard`)
- `src/app-prefetch.ts`: the header tabs' `preload` and `prefetch` (from each feature's
  `./routes`) by route name. `main.ts` loads the tabs' code once the app is idle
  (`@stash/web-platform/idle`), and the header loads a tab's first data when the pointer, a finger
  or the focus is on it. `app-router.ts` keeps each tab's scroll position
  (`@stash/web-platform/page-scroll`).
- `src/app-registry.ts` (the atom registry with the live layers, among them the recent searches
  of `@stash/web-search/search-atoms`)
- `src/web-worker.ts` (the `Web` Worker entry, see Rules)
- `vite.config.ts` (it also publishes `docs/ios-shortcut.md` and `docs/mcp-connector.md` at
  `/docs/*`, for the onboarding card), `public/manifest.webmanifest`, `public/favicon.svg`, `public/icons/*`
