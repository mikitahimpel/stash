# Stash tactile — design system

The source of truth for the web app's look. The spec below is committed verbatim from issue #101.
The light-mode values derived from it and the mapping to code follow it. The implementation lives
in `packages/web/ui` (`@stash/web-ui`: `src/styles.css` and the components), and the theme switch
in `packages/web/platform` (`@stash/web-platform/theme`). In dev, `/_ui` shows every primitive in
every size and state, in a grid, with a theme switch.

## Tokens (#137)

One control language for every interactive element, so a page can't read as two design systems.
**These win over every section below.** They live in `packages/web/ui/src/styles.css` and
`src/control/control-variants.ts`, and the layout audit (below) fails CI when a page drifts.

| Token | Value | Tailwind |
|---|---|---|
| Control height | **sm 32 · md 36 · lg 44** | `h-control-sm` · `h-control-md` · `h-control-lg` |
| Phone hit area | every tappable control at least 44 tall, without looking different | `hit-area` (an invisible `::after` below `sm`) |
| Radius | **8** every control · **12** surfaces (cards, menus, dialogs, toasts) · full for the avatar only | `rounded-control` · `rounded-surface` |
| Surface | `raised` (button, segmented thumb, menu trigger, chip on) · `primary` (one per screen) · `sunken` (input, search, segmented track, chip off) · `ghost` (row and toolbar actions); one 1px border, one focus ring | `controlSurfaces` |
| Text | title 28/600 · **label 14/500** (controls, row titles, section headers) · **body 14/400** · **meta 13/400**, muted, **sans** | `text-title` · `text-label` · `text-body` · `text-meta` |
| Mono | only keys (`⌘K`, `Kbd`), the device code and chart axis labels | `font-mono` in `Kbd` / `DeviceCode`, `chart-text` |
| Spacing | only 4 · 8 · 12 · 16 · 24 · 32 · 48 | `1 · 2 · 3 · 4 · 6 · 8 · 12` |
| Content edge | everything on a page (header, section headers, rows, cards, empty states) starts at the same left x and ends at the same right x; rows inside a card share the card's content edge | `ListRow` reaches 12px past the edges for its background only |

- **Titles are not underlined.** A row's title is its target (`ListRowTitle`, `data-row`), and the
  row's background shows hover and focus. `TextLink` is for links inside prose.
- **Row actions** are `ghost` (or `secondary`) at `sm`. A section header's action too. One
  `primary` per screen. The buttons of one group use the same verb style (`Mark seen`, `Mark done`,
  `Archive`, `Delete`; `Set up` on every row of a card).
- **Sizes by place:** a page's primary field and button are `md`; filter bars (segmented control,
  `Type` menu, chips), row and section actions are `sm`; Search's main field and the login
  actions are `lg`.
- **Feature code doesn't style controls or rows.** `packages/web/{links,search,open-tabs,settings,auth}`
  and `apps/web` use layout utilities only (flex, grid, gap on the scale, widths, overflow,
  visibility at a breakpoint) plus the text roles and colors above. `apps/web/test/feature-classes.test.ts`
  scans every template and fails on heights, padding, margins, radii, borders, backgrounds,
  fonts or text sizes. What a page needs beyond that becomes a kit component.

## Design spec: "Stash tactile" (shared by the UI polish issues)

Keyboard-first, quiet chrome, data over decoration. Hierarchy comes from spacing and hairline dividers, not cards or badges. No glow, glass, gradient washes, emoji or explainer copy: UI text is labels and data only.

**Type:** Geist (UI text) + Geist Mono (keys, the device code, chart axis labels; see "Tokens"). Self-host via `@fontsource-variable/geist` / `@fontsource-variable/geist-mono` (or equivalent npm packages), not a CDN. Sizes: see "Tokens" (sections are labelled, not shouted).

**Tokens (dark default; light mirrors it):**

| token | dark | light |
|---|---|---|
| background | `#0c0c0d` | `#f7f7f8` |
| surface (selected row, inputs' base) | `#18181a` | `#ffffff` |
| foreground | `#ededed` | `#111113` |
| muted-foreground (≥4.5:1) | `#8f8f8f` | `#6b6b70` |
| hairline / divider | `#1f1f21` (row: `#161618`) | `#e4e4e7` (row: `#ededf0`) |
| accent: stale / unread / match, never decoration | `#ff8a3d` | `#c2570c` |

**Tactile primitives.** Moderate depth. These are the approved values (dark); derive light equivalents with the same structure (white→`#f3f3f4` gradient raised buttons, `#d4d4d8` borders, soft `rgba(0,0,0,.06–.1)` shadows; in light mode the primary button is a dark key: `#2a2a2d→#161618`, white text):

```css
.raised{background:linear-gradient(180deg,#262629 0%,#1d1d1f 100%);border:1px solid #080809;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),inset 0 -1px 0 rgba(0,0,0,.3),0 1px 1px rgba(0,0,0,.5),0 2px 4px rgba(0,0,0,.2);color:#ededed}
.raised:hover{background:linear-gradient(180deg,#2b2b2e 0%,#202023 100%)}
.raised:active{background:#19191b;box-shadow:inset 0 1px 3px rgba(0,0,0,.6);transform:translateY(.5px)}
.primary{background:linear-gradient(180deg,#f6f6f6 0%,#dbdbdb 100%);border:1px solid #808080;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),inset 0 -1px 0 #c2c2c2,0 1px 1px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.25);color:#111}
.primary:hover{background:linear-gradient(180deg,#fbfbfb 0%,#e2e2e2 100%)}
.primary:active{background:#d6d6d6;box-shadow:inset 0 1px 3px rgba(0,0,0,.25);transform:translateY(.5px)}
.sunken{background:#09090a;border:1px solid #1c1c1e;box-shadow:inset 0 1px 3px rgba(0,0,0,.6),0 1px 0 rgba(255,255,255,.03)}
.pressed{background:#141416;border:1px solid #080809;box-shadow:inset 0 1px 3px rgba(0,0,0,.65),0 1px 0 rgba(255,255,255,.03)}
.key{min-width:20px;height:20px;padding:0 5px;border-radius:5px;background:linear-gradient(180deg,#2a2a2d,#1f1f22);border:1px solid #080809;border-bottom-width:2.5px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08);font:500 11px 'Geist Mono'}
/* selected list row */
.row-selected{background:linear-gradient(180deg,#1a1a1c,#171719);border:1px solid #0b0b0c;border-radius:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.045),0 1px 3px rgba(0,0,0,.35)}
/* links: faint underline that brightens on hover */
.link{text-decoration:underline;text-decoration-color:#3a3a3c;text-underline-offset:4px}
.link:hover{text-decoration-color:currentColor}
```

Radii and heights: see "Tokens" (keys stay 4px). Focus: 2px visible ring in foreground at 40% alpha, never removed.

**Components** (names indicative): Button (`raised` default, `primary`, `ghost`), SegmentedControl (sunken tray, active segment raised), ToggleChip (sunken; on = raised with `aria-pressed`), Input/SearchField (sunken, optional trailing `Kbd`), Kbd (keycap), ListRow (hairline divider; selected = `row-selected`, can reveal a row action bar), SectionHeader (14px/500 label + muted count + right-aligned actions), Link.

**Layout:** max-width 1040px, 24px side padding (16px on phones), top nav = wordmark `stash` + SegmentedControl (Inbox · Open now · Search · Settings) + right side (mono sync status, Search ⌘K, theme toggle). Lists are rows, not cards: title · host · device/source · age as muted 13px sans metadata. Footer shortcut hints use Kbd. Everything must work at 390px width (columns collapse; metadata wraps under the title).

**Data graphics** (inline SVG Vue components, driven by real data, `role="img"` + an `aria-label` summarising the data; mono 12px labels; neutral marks, accent only for the highlighted category):
- Open now: one lane per device; each tab is a 2×16 tick at x = age (0–14 days, older clamped to the end); region past 7 days hatched (45° pattern, hairline color) with a dashed 7d line; stale ticks in accent; the selected tab gets a taller tick and a `title · age` label.
- Inbox: 30 bars, saved per day; the read part of each bar (now `seen`/`done`) drawn lighter from the baseline; today's unread part in accent at ~45% opacity; header line in mono: `N saved · N read · N unread · last 30 days`; legend read/unread.
- Search: a timeline of up to 12 months (labels in mono; its axis fits the data, see "Data graphics" under Layout rules), every saved link a small neutral dot, matches as accent dots numbered by rank.

## Light mode (derived)

Light mirrors dark with the same structure: raised keys are a white→`#f3f3f4` gradient with
`#d4d4d8` borders and soft shadows, and the primary button flips to a dark key. These are the final
values (tokens in `:root` of `packages/web/ui/src/styles.css`; `.dark` holds the dark ones above).

```css
.raised{background:linear-gradient(180deg,#ffffff 0%,#f3f3f4 100%);border:1px solid #d4d4d8;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),inset 0 -1px 0 rgba(0,0,0,.04),0 1px 1px rgba(0,0,0,.08),0 2px 4px rgba(0,0,0,.06);color:#111113}
.raised:hover{background:linear-gradient(180deg,#fbfbfb 0%,#ededef 100%)}
.raised:active{background:#ebebed;box-shadow:inset 0 1px 3px rgba(0,0,0,.12);transform:translateY(.5px)}
.primary{background:linear-gradient(180deg,#2a2a2d 0%,#161618 100%);border:1px solid #0b0b0c;box-shadow:inset 0 1px 0 rgba(255,255,255,.12),inset 0 -1px 0 rgba(0,0,0,.4),0 1px 1px rgba(0,0,0,.1),0 2px 6px rgba(0,0,0,.1);color:#fff}
.primary:hover{background:linear-gradient(180deg,#333337 0%,#1c1c1f 100%)}
.primary:active{background:#161618;box-shadow:inset 0 1px 3px rgba(0,0,0,.5);transform:translateY(.5px)}
.sunken{background:#efeff1;border:1px solid #d4d4d8;box-shadow:inset 0 1px 2px rgba(0,0,0,.06),0 1px 0 rgba(255,255,255,.8)}
.pressed{background:#e9e9ec;border:1px solid #d4d4d8;box-shadow:inset 0 1px 3px rgba(0,0,0,.1),0 1px 0 rgba(255,255,255,.8)}
.key{background:linear-gradient(180deg,#ffffff,#f3f3f4);border:1px solid #d4d4d8;border-bottom-width:2.5px;box-shadow:inset 0 1px 0 rgba(255,255,255,.9)}
.row-selected{background:linear-gradient(180deg,#ffffff,#fcfcfd);border:1px solid #e4e4e7;border-radius:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 1px 3px rgba(0,0,0,.06)}
.link{text-decoration-color:#c4c4c8}
```

Other light values: dialog and menu overlay `rgba(0,0,0,.3)` (dark `.6`); popover shadow
`0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.1)` (dark `.5` / `.45`); destructive `#c42b2b`
(dark `#ff6b6b`).

### Contrast

`packages/web/ui/test/contrast.test.ts` computes the WCAG ratio of every text / background token
pair in both themes and requires ≥4.5:1, and ≥3:1 for the accent as a non-text mark. The light
accent `#c2570c` is 4.2:1 on the light background, so it marks things (ticks, dots, bars) and is
not a text color for body copy. Keep color tokens as `#rrggbb` so the test can read them.

## Layout rules (visual polish, #125)

These refine the spec above and include the hierarchy pass of #135. Where they differ (the page
heading size, the header, the width, the row height, chips and control heights), they win.

### Spacing scale

Every gap, padding and margin is one of **4 · 8 · 12 · 16 · 24 · 32 · 48 px** (Tailwind `1 · 2 · 3
· 4 · 6 · 8 · 12`). Typical uses:

| px | use |
|---|---|
| 4 | title and its subtitle, icon and label inside a control |
| 8 | chips and buttons in a row, cluster items in the header |
| 12 | row padding (`px-3`), a section header and its first row |
| 16 | side padding on phones |
| 24 | blocks and sections on a page (`gap-6`), side padding from `sm` up |
| 32 | top of the content under the header (`sm:pt-8`) |
| 48 | between the page header and the content, empty and error states (`py-12`) |

### Page content

Page content is at most **960px** wide, centred, with the header on the same width. **48px** lies
between the page header and the content, and **24px** between sections (Settings included). Mono is
only for keys, the device code and chart axis labels (see "Tokens").

### Page header

Each page starts with `<PageHeader>` (`@stash/web-ui/page-header`): the title as the page's only
`h1`, **28px/600**, tight tracking, and under it one regular-sans muted line
(`6 unread · 30 saved in 30 days`). The line appears once there is something to count, so a
first-run page has the title alone. The page's **primary action** sits on the right, in the
`#actions` slot: Inbox has the Save a link field (sunken input and primary Save; Enter submits, and
the new row shows at once), Open now has Add device (except on its onboarding card, which offers
it per device), Search and Settings have none. On phones it takes its own full-width line under
the title. Sections inside a page keep `<SectionHeader>`
(14px/500). `PageHeader` carries its own 24px bottom margin, which adds to the page's `gap-6`.

### Control hierarchy

Weight follows importance, so filters never look like navigation:

| Control | Look |
|---|---|
| Navigation | plain text tabs |
| Primary action | `primary` key, **at most one per screen** |
| Real actions | `raised` keys |
| Row and section actions | `ghost` (or `secondary`) keys, `sm` |
| View switch | `SegmentedControl`, `sm` in filter bars and rows |
| One-of-many filter | one compact `FilterMenu` (`Type: Any ▾`), a raised menu trigger, `sm` |
| Toggle filters (tags, devices) | `ToggleChip`, `sm`: sunken while off, raised while on |

A filter bar is one row of `sm` controls, all 32px on one centre line.

### Rows

Every list (Inbox, Search results, Open now, Settings devices and tokens, Start saving) is built
from `ListRow`: `leading` · `title` · `meta` · `trailing` on a 36px title line, then extra lines
(summary, tags) and, while selected, the action bar. A single-line row is 52px. On phones the meta
wraps under the title. Row text, section headers and the page title all start on the content edge,
and trailing controls end on it; the row's box reaches 12px past both edges so its hover, focus
and selected background has room.

### Data graphics

A data graphic renders only with data: **below 3 data points it shows nothing**, not an empty axis.
For the Inbox chart a data point is a day with saved links. For the Search timeline it is a distinct
link on the axis, and it needs at least one match, so there is none without a query. The Open now
chart goes when no tab is left to draw. Legends sit directly under or beside their chart, never at
the far edge. Each chart's counts are in the page subtitle, not in a second line above the chart.
The Search timeline fits its axis to the data instead of a fixed 12 months: from
the oldest link shown (at least 30 days, at most 12 months back) to now, with weekly ticks
(`Oct 5`) up to about three months and month ticks beyond. On phones every other tick label is
dropped once there are more than six, and rank numbers that would collide move to another lane.

### Empty and error states

An empty page says how to start. `<StartSavingCard>` (`@stash/web-settings/start-saving-card`) is
the first-run state: a surface card with a title and one row per way to start, each with a single
action. The Inbox shows "Start saving" (Zen extension, iPhone, Claude) when nothing is saved, without
the filters. Open now shows "Connect a device" (Zen extension, iPhone through a Mac) when no device exists. A
device action goes to `/settings?add=device&kind=<kind>`, which opens the dialog that creates the
token, on that kind. The card appears only when nothing is saved at all, of any status or age: an
empty feed alone says nothing about that. The doc links open
`/docs/ios-shortcut.md` and `/docs/mcp-connector.md`, which `apps/web` publishes from `docs/` at
build time. Search with no query is just the focused field with a muted example query.

A section of a page that is empty stays one compact row (`No devices yet` in Settings), with the
action in its section header. No section repeats that action.

`<EmptyState>` and `<ErrorState>` cover the rest (nothing matches a filter, a failed load). They are
centred in the content area with `py-12`: a 14px/500 title, one muted line that says why the area is
empty or what failed, and, where there is one, an action (Retry, Clear filter). No
illustration beyond an optional 20px icon.

### App header

One quiet row, with the same max width (960px) and side padding as `<main>`, 56px tall, sticky,
hairline below.

- Left: wordmark, then the nav as plain text tabs (Inbox, Open now, Search, Settings) with a 2px
  underline on the active one, no tray and no borders. The Search tab carries the `⌘K` hint as a
  muted `kbd`, and it is the only Search entry point.
- Right: **one account menu button** (the login's initial on a round avatar) holding the theme
  switch (System / Light / Dark as radio items), the sync status and Sign out. An 8px accent dot on
  the button appears only when offline; otherwise the status stays in the menu.
- Every icon-only control has an accessible name (`aria-label`) and a tooltip (`title`).

### Phone (< 640px)

- No horizontal scroll at 390px on any page.
- The nav moves to a **bottom bar**: the same text tabs, full width, fixed above the home indicator
  (`env(safe-area-inset-bottom)`). `<main>` pads its bottom so content clears it. The `⌘K` hint is
  hidden.
- The header keeps the wordmark and the account button.
- Keyboard shortcut footers are hidden.
- A row of chips stays on one line and scrolls on its own, out to the edge of the screen.

### Screenshots

`pnpm --filter @stash/web screenshots` boots the api under `alchemy dev` (stage `screenshots`, no
credentials), seeds synthetic data and a session through the dev-only `/_smoke/seed` and
`/_smoke/session` routes, runs Vite against it and captures every page (Inbox, Open now, Search
with results, Settings, Login, `/_ui`) in dark and light at 1440×900 and 390×844 into
[`docs/screenshots/`](screenshots/). Inbox, Open now, Search and Settings are also captured as a
first-run user with no data (`inbox-empty-light-desktop.png` and so on), with the browser answering
the data requests with empty results. Before each capture the viewport grows to the page's height,
so the phone's bottom nav sits at the bottom of the picture as on a screen. Pages are cut at
2000px, except `/_ui`, which is captured whole. It fails when a page
scrolls sideways or a button has no accessible name. Chromium needs its system libraries
(`pnpm --filter @stash/web exec playwright install-deps chromium` once per machine).

### Layout audit

`pnpm --filter @stash/web audit:layout` (CI job `layout-audit`) builds the app, serves it with
`vite preview` and opens every page in headless Chromium, one at a time: Inbox, Open now, Search
with results, Settings, each seeded and as a first-run user, plus Login, in the light theme at
1440 and 390 wide. The api is answered in the browser from synthetic fixtures
(`apps/web/scripts/layout-fixtures.ts`). On each page it checks:

- every visible `button`, `input` (by its field box), `[role=tab]`, `[role=menuitem]`,
  `[role=radio]` and `a[data-row]` is 32, 36 or 44 tall, and on phones has a hit area of at least 44;
- controls on one row share their height and vertical centre;
- every page-level block starts on the content edge (± 0.5px), trailing controls end on it, rows
  inside a card share one edge, and every line of a row starts where its title does;
- every vertical gap between page-level blocks is on the spacing scale;
- text renders in mono only inside keys, the device code and charts.

It prints a table of violations and exits 1 on any. The rules are plain functions
(`scripts/layout-audit-rules.ts`, tested in `test/layout-audit-rules.test.ts`), measured by
`scripts/layout-audit-probe.ts` in the page. Chromium needs its system libraries
(`pnpm --filter @stash/web exec playwright install --with-deps chromium`, or the libraries
extracted locally and put on `LD_LIBRARY_PATH`).

## In code

| Spec | CSS variable | Tailwind |
|---|---|---|
| background | `--background` | `bg-background` |
| surface | `--surface` | `bg-surface` (also `card`, `popover`) |
| foreground | `--foreground` | `text-foreground` |
| muted-foreground | `--muted-foreground` | `text-muted-foreground` |
| hairline / row hairline | `--hairline` / `--hairline-row` | `border-hairline`, `border-hairline-row` |
| accent | `--signal` | `text-signal`, `bg-signal`, `fill-signal` |
| raised, primary, sunken, pressed, key, row-selected | `--raised-*`, `--key-primary-*`, `--sunken*`, `--pressed*`, `--key-*`, `--row-selected-*` | `tactile-raised`, `tactile-primary`, `tactile-sunken`, `tactile-pressed`, `tactile-key`, `tactile-row-selected` |
| link | `--link-underline` | `link-underline` |
| Geist / Geist Mono | `--font-sans` / `--font-mono` | `font-sans` (body default), `font-mono` |

- The spec's **accent** is `signal` in code, because shadcn's `accent` (kept so existing
  components don't break) is the neutral hover surface.
- The other shadcn names (`primary`, `secondary`, `muted`, `border`, `input`, `ring` and so on)
  stay as aliases of the tokens above.
- **Focus**: the base layer gives every `:focus-visible` element a 2px outline in the foreground
  at 40%. Components don't remove it.
- **Radii and heights**: see "Tokens". `rounded-md` and `rounded-lg` are aliases of
  `rounded-control`, `rounded-xl` of `rounded-surface`.
- **Theme**: `@stash/web-platform/theme` keeps the preference (`system` | `light` | `dark`,
  default `system`) in the platform `KeyValueStore` and toggles the `dark` class on `<html>`,
  following `prefers-color-scheme` while the preference is `system`.

### Components

| Spec | `@stash/web-ui` export |
|---|---|
| Button (`raised`, `primary`, `ghost`) | `button`, `button-variants` |
| SegmentedControl | `segmented-control` (radio group; arrow keys, Home and End move the selection) |
| ToggleChip | `toggle-chip` (`v-model:pressed`, `aria-pressed`, `size`) |
| FilterMenu | `filter-menu` (`label`, `options`, `v-model`, `""` for Any, `size`): the compact `Type: Any ▾` |
| Input / SearchField | `input`, `search-field` (`size`; `shortcut` adds a trailing `Kbd`) |
| Kbd | `kbd` |
| ListRow | `list-row` (slots `leading`, `title`, `meta`, `trailing`, extra lines, `#actions` while `selected`), `list-row-title` |
| Card | `card`, `card-header`, `card-title`, … |
| Avatar | `avatar-button` |
| App shell | `app-frame`, `app-bar`, `app-main`, `nav-bar`, `nav-tab`, `nav-shortcut`, `wordmark`, `centered-screen` |
| PageHeader | `page-header` (`title`, `subtitle`, `#actions`): the page's `h1` |
| SectionHeader | `section-header` (`title`, `count`, `#actions`) |
| Link | `text-link` |
| Menu | `dropdown-menu*`, with `dropdown-menu-radio-group` / `dropdown-menu-radio-item` for a choice (the theme switch in the account menu, `filter-menu`) |
