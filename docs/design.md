# Stash tactile — design system

The source of truth for the web app's look. The spec below is committed verbatim from issue #101.
The light-mode values derived from it and the mapping to code follow it. The implementation lives
in `packages/web/ui` (`@stash/web-ui`: `src/styles.css` and the components), and the theme switch
in `packages/web/platform` (`@stash/web-platform/theme`). In dev, `/_ui` shows every primitive in
every state, with a theme switch.

## Design spec: "Stash tactile" (shared by the UI polish issues)

Keyboard-first, quiet chrome, data over decoration. Hierarchy comes from spacing and hairline dividers, not cards or badges. No glow, glass, gradient washes, emoji or explainer copy: UI text is labels and data only.

**Type:** Geist (UI text) + Geist Mono (metadata: domains, devices, ages, counts, shortcuts). Self-host via `@fontsource-variable/geist` / `@fontsource-variable/geist-mono` (or equivalent npm packages), not a CDN. Sizes: 14px body, 13px controls, 12px mono metadata, 15px titles in lists, page headings 14px/500 (sections are labelled, not shouted).

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

Radii: buttons 8px, inputs/trays 10px, chips 9px, keys 5px. Heights: controls ≥34px (touch ≥40px for primary actions on mobile). Focus: 2px visible ring in foreground at 40% alpha, never removed.

**Components** (names indicative): Button (`raised` default, `primary`, `ghost`), SegmentedControl (sunken tray, active segment raised), ToggleChip (raised; on = pressed with `aria-pressed`), Input/SearchField (sunken, optional trailing `Kbd`), Kbd (keycap), ListRow (hairline divider; selected = `row-selected`, can reveal a row action bar), SectionHeader (14px/500 label + mono count + right-aligned actions), Link.

**Layout:** max-width 1040px, 24px side padding (16px on phones), top nav = wordmark `stash` + SegmentedControl (Inbox · Open now · Search · Settings) + right side (mono sync status, Search ⌘K, theme toggle). Lists are rows, not cards: title (link) · mono host · mono device/source · mono age, right-aligned. Footer shortcut hints use Kbd. Everything must work at 390px width (columns collapse; mono metadata wraps under the title).

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

These refine the spec above. Where they differ (the page heading size, the header's right side),
they win.

### Spacing scale

Every gap, padding and margin is one of **4 · 8 · 12 · 16 · 24 · 32 · 48 px** (Tailwind `1 · 2 · 3
· 4 · 6 · 8 · 12`). Typical uses:

| px | use |
|---|---|
| 4 | title and its subtitle, icon and label inside a control |
| 8 | chips and buttons in a row, cluster items in the header |
| 12 | row padding (`px-3`), a section header and its first row |
| 16 | side padding on phones |
| 24 | blocks on a page (`gap-6`), side padding from `sm` up |
| 32 | top of the content under the header (`sm:pt-8`) |
| 48 | between the sections of Settings, empty and error states (`py-12`) |

### Page header

Each page starts with `<PageHeader>` (`@stash/web-ui/page-header`): the title as the page's only
`h1`, **20px/600**, and under it one mono 12px line of counts in muted foreground
(`17 tabs · 3 devices · 6 older than 7 days`). Sections inside a page keep `<SectionHeader>`
(14px/500). The subtitle appears once the data has loaded; before that the title stands alone.

### Rows

List rows are at least **44px** tall (`ListRow` has `min-h-11`). On phones metadata wraps under
the title instead of squeezing beside it. Section headers start at the content edge, like the page
title; row content is inset by the `ListRow` padding (12px). Where a page has controls at the end
of its rows (Settings), every row and section control ends on that same 12px inset.

### Data graphics

Each chart's summary line is the page subtitle, not a second mono line above the chart; the chart
keeps its legend. The Search timeline fits its axis to the data instead of a fixed 12 months: from
the oldest link shown (at least 30 days, at most 12 months back) to now, with weekly ticks
(`Oct 5`) up to about three months and month ticks beyond. On phones every other tick label is
dropped once there are more than six, and rank numbers that would collide move to another lane.

### Empty and error states

`<EmptyState>` and `<ErrorState>` are centred in the content area with `py-12`: a 14px/500 title,
one muted line that says why the area is empty or what failed, and, where there is one, an action
(Retry, Clear filter, Add a device). No illustration beyond an optional 20px icon.

### App header

- Same max width (1040px) and side padding as `<main>`, 56px tall, sticky, hairline below.
- Left: wordmark, then the nav (a SegmentedControl of links).
- Right: **one cluster**, in this order: sync status (an 8px dot plus mono `online` / `offline`;
  the dot turns accent when offline; a tooltip explains it), Search with `⌘K`, the theme menu
  (System / Light / Dark as radio items, the trigger shows the current one's icon), and the
  account menu (Settings, Sign out).
- Every icon-only control has an accessible name (`aria-label`) and a tooltip (`title`).

### Phone (< 640px)

- No horizontal scroll at 390px on any page.
- The nav moves to a **bottom bar**: the same SegmentedControl, full width, fixed above the home
  indicator (`env(safe-area-inset-bottom)`). `<main>` pads its bottom so content clears it.
- The header keeps the wordmark and the cluster: the sync status shows only its dot, and Search is
  an icon key (its label stays for screen readers).
- Keyboard shortcut footers are hidden.

### Screenshots

`pnpm --filter @stash/web screenshots` boots the api under `alchemy dev` (stage `screenshots`, no
credentials), seeds synthetic data and a session through the dev-only `/_smoke/seed` and
`/_smoke/session` routes, runs Vite against it and captures every page (Inbox, Open now, Search
with results, Settings, Login, `/_ui`) in dark and light at 1440×900 and 390×844 into
[`docs/screenshots/`](screenshots/). Before each capture the viewport grows to the page's height,
so the phone's bottom nav sits at the bottom of the picture as on a screen. Pages are cut at
2000px, except `/_ui`, which is captured whole. It fails when a page
scrolls sideways or a button has no accessible name. Chromium needs its system libraries
(`pnpm --filter @stash/web exec playwright install-deps chromium` once per machine).

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
- **Radii**: `rounded-md` is 8px (buttons), `rounded-lg` 10px (inputs, trays). Chips use
  `rounded-[9px]` and keys `rounded-[5px]`.
- **Theme**: `@stash/web-platform/theme` keeps the preference (`system` | `light` | `dark`,
  default `system`) in the platform `KeyValueStore` and toggles the `dark` class on `<html>`,
  following `prefers-color-scheme` while the preference is `system`.

### Components

| Spec | `@stash/web-ui` export |
|---|---|
| Button (`raised`, `primary`, `ghost`) | `button`, `button-variants` |
| SegmentedControl | `segmented-control` (radio group; arrow keys, Home and End move the selection), `segmented-control-variants` (its classes, for a nav of links such as the app header) |
| ToggleChip | `toggle-chip` (`v-model:pressed`, `aria-pressed`) |
| Input / SearchField | `input`, `search-field` (`shortcut` adds a trailing `Kbd`) |
| Kbd | `kbd` |
| ListRow | `list-row` (`selected`, `#actions` row action bar) |
| PageHeader | `page-header` (`title`, `subtitle`, `#actions`): the page's `h1` |
| SectionHeader | `section-header` (`title`, `count`, `#actions`) |
| Link | `text-link` |
| Menu | `dropdown-menu*`, with `dropdown-menu-radio-group` / `dropdown-menu-radio-item` for a choice (the header's theme menu) |
