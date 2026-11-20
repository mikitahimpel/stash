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
  `src/web-worker.ts` is the `Web` Worker: it runs first for every path but `/assets/*` and
  `/downloads/*`. It forwards `/api` and `/api/*` to the api through the `API` Service Binding with
  the prefix stripped, on any host. On a stage with a custom domain it also forwards the MCP
  server's paths (`/mcp`, `/authorize`, `/token`, `/register`, `/.well-known/oauth-*`) to the mcp
  Worker through the `MCP` binding, URL unchanged, and answers a GET of a page on its old
  `*.workers.dev` host with a 301 to the domain (see
  [docs/deploy.md](../../docs/deploy.md#custom-domain)). Everything else goes to `ASSETS`. **Never
  add an SPA route under one of the MCP paths**: `test/web-worker.test.ts` checks the router
  against them. A Workers entry may export only handlers, so it exports nothing but `default` and
  types. The SPA's api base URL defaults to
  `/api` (`@stash/web-api-client/api-base-url`) and `VITE_API_BASE_URL` overrides it, never a
  hardcoded URL. The Vite dev and preview servers proxy `/api` (WebSockets too, for the live stream) to `STASH_DEV_API_URL` (default
  `http://localhost:8787`, `alchemy dev`).
- `scripts/live-session-check.ts` (`pnpm --filter @stash/web check:live`): the scripted check of a
  deployed web origin (same-origin api, no `stash-api.` in the bundle, session cookie round-trip,
  the live stream with the site's own `Origin`; with `STASH_MCP_URL` the OAuth discovery on the
  site's host, with `STASH_OLD_WEB_URL` the redirect of the old `workers.dev` pages),
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
  `scripts/layout-fixtures.ts` (links, tabs, devices; `seeded(now, { tabs })` picks what Open now
  shows: the seeded account with stale and saved tabs, `many` or `two`; one post on X of each kind:
  `postLinkIds`, and media that are not 16:9: a portrait video and photo, a square and a panorama
  among the posts, a YouTube Short and a portrait og:image in `shapeLinkIds`; their pictures are
  `…/previews/shapes/<name>.svg`). `scripts/preview-images.ts` draws the fixtures' preview images and people's
  pictures (SVG); the audit and the screenshots answer `https://example.com/previews/*` with them in the
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
  shows a skeleton, doesn't ask for the tab's own data again (`/auth/me` doesn't count), or loses
  the tab's scroll position; when a link saved "on another device" between two visits of the Inbox
  doesn't show; also when a first
  visit or a hovered tab doesn't open with its layout and rows at once. A walk with a
  problem is repeated twice (a busy machine makes single frames late). `STASH_SWITCH_CPU`,
  `STASH_SWITCH_NETWORK=slow`, `STASH_SWITCH_API_DELAY` and `STASH_SWITCH_PROFILE=<dir>` turn it
  into a measurement. Its in-page timing is `scripts/tab-switch-probe.ts`.
- `scripts/loading-states.ts` (`pnpm --filter @stash/web check:loading`, after a build; the same
  CI job): the skeletons' boxes against the loaded content and the Cumulative Layout Shift of
  each page with a slow api, see "Loading states" in [docs/design.md](../../docs/design.md).
  `--screenshots` writes `docs/screenshots/loading-*.png`. Its in-page measuring is
  `scripts/loading-states-probe.ts`.
- `scripts/live-updates.ts` (`pnpm --filter @stash/web check:live-updates`, after a build; the
  same CI job): plays the api's event stream to the built app and fails unless a pending Inbox
  row turns from `summarizing…` into its summary with no reload, no request, the same row height
  and a Cumulative Layout Shift of at most 0.01, and unless a link saved on another device then
  appears on top of the Inbox under the same limits, at desktop and phone width; then, on Open
  now, that a tab opened in a fake extension client (the fake api sends the `tabs.updated` the
  real one would) shows within 3 s and a closed one fades out and leaves, with no reload, no new
  `GET /tabs` and CLS ≤ 0.01. The browser
  checks share `STASH_AUDIT_PORT` (default 4179) and reuse whatever answers there: set another
  port when a second worktree may be serving its own build.
- `scripts/check-clock.ts`: the clock of the browser checks on synthetic data (layout audit,
  Connect walk, tab switch, loading states, live updates, and the screenshots' pages on the
  fixtures or on no data, among them every Inbox view), so they and the PNGs are the same at any
  hour (#188). Each opens its browser contexts with `CheckClock.newContext` (Wednesday 17 June
  2026, 12:00 UTC, time flowing from there, real timers) and dates its fixtures with
  `CheckClock.now()`; never `Date.now()` for data or `browser.newContext` in a check.
  `test/check-clock.test.ts` enforces it; `check:loading` fails unless the Inbox opens on Today
  with two rows or more. Only views without day groups stay on the wall clock and the real api
  (the screenshots of Settings, the search results, the header, the invite and the login;
  `sign-in-walk.ts`, `live-session-check.ts`).
- `scripts/sign-in-walk.ts` (`pnpm --filter @stash/web walk:sign-in`): boots `alchemy dev`
  (stage `sign-in-walk`), Vite and a fake OpenID provider of its own (`GOOGLE_FAKE_IDP`, RS256
  ID tokens from a key made per run), and walks #178 in headless Chromium against the real api:
  passkey sign-up from an invite and sign-in with a CDP virtual authenticator, Settings →
  Security, Google sign-up from an invite, sign-in by `sub`, and a refused account. Every server
  stops at the end.
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
  `./routes`) by route name. `main.ts` loads the tabs' code and, for a signed-in user, their first data once
  the app is idle (`@stash/web-platform/idle`), and the header loads a tab's first data when the pointer, a finger
  or the focus is on it. `app-router.ts` keeps each tab's scroll position
  (`@stash/web-platform/page-scroll`).
- `src/app-registry.ts` (the atom registry with the live layers, among them the recent searches
  of `@stash/web-search/search-atoms`)
- `src/web-worker.ts` (the `Web` Worker entry, see Rules)
- `vite.config.ts` (it also publishes `docs/ios-shortcut.md` and `docs/mcp-connector.md` at
  `/docs/*`, for the onboarding card), `public/manifest.webmanifest`, `public/favicon.svg`, `public/icons/*`
