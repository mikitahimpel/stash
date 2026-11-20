# CLAUDE.md — packages/web

Read the root [CLAUDE.md](../../CLAUDE.md) first. This file adds the rules for the web context.
The deployable is `apps/web` (see `apps/web/CLAUDE.md`).

## Purpose

Features and UI for the Vue 3 web app: search, feeds, the "Open now" tab view and settings. The
app can be installed to the iPhone home screen.

| Package | Name | Contents |
|---|---|---|
| `links/` | `@stash/web-links` | Inbox: Save a link field, feeds (not yet seen, recent, all), links as media rows grouped by day, 30-day counts in the subtitle, tag and type filters, status actions and keys; the same list as search results while the URL has `?q=`; a link's page (`/links/<id>`: preview or YouTube player, summary, tags, actions, details); a post on X as a row in a post's order and, on its page, as a post card (`post-display`); the `/save` result |
| `search/` | `@stash/web-search` | Search without a page: the header's field (`search-box`, debounced into the Inbox's URL `/links?q=…`, recent searches under the focused empty field), the line over the results (`search-bar`: count, mode, type / device / date menus), the URL state (`search-route`), the results that keep the last answer while the next loads (`use-search-results`), term marking; `/search` redirects to the Inbox |
| `open-tabs/` | `@stash/web-open-tabs` | "Open now": every device's open tabs as compact rows grouped by device (sticky headers that fold) and by window inside a device, with the stale ones (open over 7 days) in a group of their own, a filter, row actions (save, copy link, open, archive, close on device), bulk save of picked or stale tabs, and a Saved mark on tabs that are already links (the api's `saved`); live from `tabs.updated` (`live-rows.ts`: closed rows fade, rows slide into place) |
| `settings/` | `@stash/web-settings` | One Settings page: Devices & connections (the section from `@stash/web-connect`, then the devices), API tokens, Appearance (theme atoms, also used by the app header), then `security/security-section` (Settings → Security, #178: passkeys, linked Google and GitHub, add and remove, never the last way in), then `members/members-section`: one quiet line about today's AI summaries for a user with a daily cap, and for the owner the Members (people, remove with a confirmation that their data is deleted, invite links shown once); first-run onboarding card (used by Inbox and Open now) |
| `connect/` | `@stash/web-connect` | The "Devices & connections" section of Settings (`connect-section`): one row per source (iPhone, Zen, Mac, Claude) with its status and a guide that creates the device and token, prefills every value and waits for the first save; `/connect[?guide=…]` redirects to it; extension pairing (`/connect/extension`) |
| `auth/` | `@stash/web-auth` | Login page: Continue with passkey (primary), Google (only when `providers.google`), GitHub (Device Flow); `sign-in-atoms` for the passkey ceremonies and Google's start URL; `?signin=` errors from the Google callback; a return path outside the app (`/authorize/...`, the MCP sign-in) opens with a full page load. Also `/invite/<token>`: the same page, which says "You were invited to Stash", makes a passkey for the new account or sends the invite with Google and GitHub; `me` atom, auth guard, account menu (a slot for the app's entries, Sign out) |
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
`BrowserHttpClient`), adds its own services (`share`, `network`, `visibility` (with the window's focus), `theme`, `keyboard`, `live-socket`, `recent-searches`, `passkeys` over `@simplewebauthn/browser`), the plain readers `page-origin`, `page-scroll` and `idle` (`whenIdle`), `page-navigation` (a full page load, for Google and the MCP sign-in), and exports
in-memory layers as `./testing`. Features depend on the services, and `apps/web` provides the live
layers.

## Rules

- State lives in atoms (`@effect/atom-vue`) that wrap Effect programs. Components stay thin: they
  read atoms and call actions.
- Each feature exports its routes (`./routes`) and the components other features may use.
  `apps/web` mounts the routes.
- Api queries (`ApiAtoms.query`, `ApiAtoms.pages`) are cached and revalidated: they outlive the
  page that reads them, so a page opened again shows its data at once and refreshes it in the
  background. A feature whose page is a header tab exports `preload` (the page's code) and
  `prefetch` (its code and first data, `ApiAtoms.prefetch`) from `./routes`; the app header calls
  them on idle and on hover. Pages show a skeleton only on a first load that takes over 150 ms,
  and then for at least 300 ms (`useDelayedLoading` from `@stash/web-ui/use-delayed-loading`: the
  page shows the skeleton while it is true), and a failed load with nothing cached as
  `<ErrorState>` (`@stash/web-ui/error-state`) with a Retry that refreshes the atom.
- **Nothing moves when data arrives.** A skeleton is the real layout with placeholder blocks:
  `<MediaRowSkeleton>`, `<CompactRowSkeleton>` and `<ListRowSkeleton>` for rows, `<GroupHeader placeholder>`, and
  `<Skeleton>` shapes for the rest, in the same containers and gaps as the loaded page. The frame
  of a page (header, filters) is the same while loading, loaded, empty and failed: `<PageHeader>`
  gets `subtitle=""` until the counts are there, and a section whose place depends on a list of
  unknown length appears with the data instead of moving. `pnpm --filter @stash/web
  check:loading` measures it (see "Loading states" in [docs/design.md](../../docs/design.md)).
- **Links update live, in place.** `@stash/web-api-client/live-links` holds one WebSocket to the
  api's `/events` while the tab is visible (the app mounts `LiveLinks.connection` for a signed-in
  user) and records each event in `@stash/web-api-client/link-patches`. `ApiAtoms.query` and
  `ApiAtoms.pages` lay those patches over their answers when read: any link-shaped object in an
  answer is replaced by a later copy (`updatedAt` decides), and a deleted link leaves its lists. A
  patch is not a request and does not refresh anything, so a row keeps its place and its height.
  A newest-first list of links that passes `accepts` to `ApiAtoms.pages` (its filters, as
  `LinksAtoms.lists`) also gets the links it does not hold yet, such as one saved on another
  device, at their place by `createdAt`; the Inbox then slides the rows under a new one down
  from where they were (`list/keep-place.ts`), which the browser counts as no layout shift.
  Features need no code for this; keep api answers plain data with whole `Link`s in them. On
  reconnect and on window focus it catches up with `GET /links?updatedSince=`; without a stream it
  asks only for the pending links on screen (`?ids=`, 3 s backing off to 30 s, nothing when none
  is pending). Open tabs come the same way: a `tabs.updated` event (a device's whole new tab set)
  is kept in `@stash/web-api-client/tab-patches` and laid over the cached `GET /tabs` by
  `OpenTabsAtoms.live` (a device the answer does not list shows only if its event came after the
  answer's `at`, so a deleted device stays away); after a gap of the stream Open now asks for the tabs again in the
  background. `pnpm --filter @stash/web check:live-updates` checks both in a browser.
- Any 401 from the api sends the user to the login page, which returns to the page they wanted
  (`@stash/web-auth/auth-guard`). Pages don't handle `Unauthorized` themselves.
- Links are `<MediaRow>`s (preview, title, one meta line, one summary line, one
  `<TagLine>`) under `<GroupHeader>`s; open tabs are `<CompactRow>`s (48px: site icon, title, one
  meta line, actions at the end; see "Open now" in [docs/design.md](../../docs/design.md)); other lists are `<ListRow>`s. Every media row of a list is
  one height: a row never wraps or grows, and a list with tags passes the `tags` slot on every row. See "Media rows" in
  [docs/design.md](../../docs/design.md). A post on X is a `<MediaRow meta-first>`: the author's
  line (`<PostByline size="row">`) first, then its words on two lines.
- A post's own page shows it with the kit's `<PostCard>`, `<PostByline>`, `<PostText>` and
  `<PostMedia>` (photo grid, lightbox, video); see "Post page" in
  [docs/design.md](../../docs/design.md). Remote pictures always load lazily with
  `referrerpolicy="no-referrer"`, and a video only inside `<PostMedia>`'s frame.
- Media keep their shape (#176). Every preview, poster and photo is drawn by the kit's
  `<MediaFit>` (inside `<MediaThumb>`, `<MediaHero>`, `<PostMedia>`): it fills a box of a close
  shape from the picture's upper third, and shows any other shape whole over a blurred copy. Pass
  `aspect` when the data has the size (`LinkDisplay.imageAspect`, a post's media, a YouTube
  Short); otherwise it is measured on load, inside a box that never changes. Big media are at
  most `min(70vh, 640px)` tall (`@stash/web-ui/media-shape`).
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
  `lg` 44); row actions are `ghost` `sm`, lists are `MediaRow`, `CompactRow` or `ListRow` with their slots. Need a look the kit
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
