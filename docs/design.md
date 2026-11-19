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
| Text | title 28/600 · **label 14/500** (controls, row titles, section headers) · **body 14/400** · **meta 13/400**, muted, **sans** | `text-title` · `text-label` · `text-body` · `text-meta`; reading text (a link's summary on its page) is 16/1.6, `text-prose` |
| Mono | only keys (`⌘K`, `Kbd`), the device code, chart axis labels and values to copy (read-only `<Input mono>`, such as the Connect guides' commands) | `font-mono` in `Kbd` / `DeviceCode` / `Input mono`, `chart-text` |
| Guides | numbered steps (`StepList`, `Step`: a sunken number, a label title, its content under it) and a quiet `Disclosure` for advanced options | `@stash/web-ui/step-list`, `/step`, `/disclosure` |
| Spacing | only 4 · 8 · 12 · 16 · 24 · 32 · 48 | `1 · 2 · 3 · 4 · 6 · 8 · 12` |
| Content edge | everything on a page (header, section headers, rows, cards, empty states) starts at the same left x and ends at the same right x; rows inside a card share the card's content edge | `ListRow` reaches 12px past the edges for its background only; a `MediaRow`'s box sits on the edges and its content is 12px inside |

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

The extension's pages use the same values: `apps/extension/assets/tokens.css` is a hand-kept copy
of the color and surface tokens (contexts share no code), with the dark theme under
`prefers-color-scheme` instead of the `dark` class. Change a value here, change it there.

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

**Layout:** max-width 1040px, 24px side padding (16px on phones), top nav = wordmark `stash` + SegmentedControl (Inbox · Open now · Search · Settings) + right side (mono sync status, Search ⌘K, theme toggle). Lists are rows, not cards: links and tabs are media rows (preview, title, one muted 13px meta line: host · author · age · device), see "Media rows". Footer shortcut hints use Kbd. Everything must work at 390px width (columns collapse; metadata wraps under the title).

**Data graphics** (inline SVG Vue components, driven by real data, `role="img"` + an `aria-label` summarising the data; mono 12px labels; neutral marks, accent only for the highlighted category):
- Open now has no graphic either (#181 dropped its age chart: one tick per tab said nothing): its counts are the page's subtitle, see "Open now" under Layout rules.
- Inbox and Search have no graphic (#148): links are media rows, see "Media rows" and "Search" under Layout rules.

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
(`6 unread · 30 saved in 30 days`). The line keeps its place while there is nothing to count
(loading, or a first-run page: `subtitle=""`), so the header is one height in every state (see
"Loading states"). The page's **primary action** sits on the right, in the
`#actions` slot: Inbox has the Save a link field (sunken input and primary Save; Enter submits, and
the new row shows at once), Open now has Add device (also over its onboarding card, which offers
the same per device), Settings has none. Search has no page: its field is in the app header (see
"Search"), and its results show under the Inbox's header. Sections inside a page keep `<SectionHeader>`
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

### Media rows (#148)

Links (Inbox, Search, the `/save` result) are `MediaRow`s, so a list reads as content, not as a
table of text. Open tabs are not reading material and have a denser row of their own, see
"Open now (#181)":

- **Every row of a list is one height** (#161), whatever it holds: 114px from `sm` up, 120px on
  phones (88px for a list without a tags line). Nothing wraps or grows; a line with nothing
  in it stays empty and keeps its place. Only the selected row is taller, by its action bar. A
  list without a tags line keeps the height from `sm` up and centres its three lines
  in it, 13px from the preview's top and bottom (#164).
- **Preview** on the left, 16:9: 160×90 from `sm` up, 110×62 on phones, radius 8. From `sm` up it
  sets the row's height and the text column fills it exactly, so the two end on one line top and
  bottom. It is the link's `imageUrl` (an `og:image`, a video thumbnail), loaded lazily and with
  `referrerpolicy="no-referrer"`. A video carries a small play mark. A YouTube link without an
  `imageUrl` shows the video's own thumbnail (`i.ytimg.com/vi/<id>/hqdefault.jpg`, from the URL).
- **The preview's box is always 16:9; the picture in it keeps its shape** (#176, `MediaFit`). A
  picture close to 16:9 (a ratio from 1.3 to 2.1) fills the box, and what is cropped comes off
  the bottom first: it is anchored to its upper third (`object-position: 50% 30%`), where faces
  usually are. A portrait, a square or a panorama is shown whole in the middle of the box, over
  a blurred, darkened copy of itself that fills the rest (a second `<img>` of the same address
  with a CSS blur, no canvas). The shape comes from the post's media when the link is a post
  (their width and height), and is otherwise measured when the picture has loaded; the box does
  not change either way.
- **A link with no image gets a generated cover** (#155), also when its image fails to
  load: a soft gradient in a hue of the site's own (a stable hash of the host; `.media-cover` in
  the kit's styles tones it light or deep per theme), the site's favicon in the centre (28px, 20px
  on phones; `/favicon.ico` on the page's origin, loaded like a preview: lazily, no referrer) and
  the host in small type under it. When the favicon fails the site's initial takes its place.
  `MediaThumb` builds it from `url`; a
  URL that is not a web page keeps the neutral tile with an initial.
- **Title** 15/600 (`text-row-title`), one line with an ellipsis (two lines at most on phones),
  with an accent dot before it while the link is not yet seen. The whole title is in its `title`
  attribute. A row shows it without the site's own name before or after it (`GitHub - … · GitHub`,
  `… | Example`: `@stash/web-ui/site-title`, when the name equals the host's); the stored title and
  the link's page keep it whole. It is the row's target: its hit area covers the whole row, and
  other links in the row (the host, a tag) sit above it.
- **One meta line**, muted 13: host · channel or author · age · device (the device is left out on
  phones). Only the author gives way when the line is too long: the host stays whole. A link
  still being enriched ends the line with `summarizing…` on phones, which have no summary line.
- **Summary**, one line with an ellipsis, from `sm` up only. A link with no summary shows who
  published it there, or nothing.
- **Tags** as 24px chips on one line (`TagLine`): as many as fit, three at most, then `+n`. On
  phones the line runs under the preview and the text, across the row.
- **A post on X is the same row in a post's order** (#170, `MediaRow meta-first`): the meta line
  comes first and starts with the author (`PostByline`: a 16px round picture, the name, a mark
  for a verified account, the @handle, which gives way first on a narrow row), then the age and the device; the unread dot
  is on this first line, as on every row; under it the post's own
  words take two lines (`MediaRowTitle :lines="2"`, 14/20 in the foreground colour, never a
  summary of them), where other rows have a title and a summary. They are the row's target. The
  preview is the post's first photo or its video's poster (with the play mark); a post without
  media shows the author's picture, 48px and round (36px on phones), on the generated cover in
  the favicon's place. The row is as tall as every other. A post that could not be read is an
  ordinary row that says `Post unavailable`.
- The row's box sits **exactly on the content edges** and its content is inset by 12px, so the
  hover, focus and selected background ends on the edge and the preview sits 12px inside it. On
  phones there is no hover and the content uses the full width.

**Levels:** page title 28/600 > `GroupHeader` (a day in the Inbox, `Results`, a device on Open now:
13/600 uppercase, a muted count, a hairline rule to the edge, optional `ghost` `sm` actions) > row
title 15/600 > meta 13. Groups sit **32px** apart, a group header **8px** above its rows, and the
lines of a media row **2px** apart (20 + 20 + 20 + 24 and three gaps make the preview's 90).

### Open now (#181)

Open tabs are scanned, not read, so the page is a compact list:

- **`CompactRow`, 48px at every width.** The site's real favicon (`SiteIcon`, 20px, from
  `/favicon.ico` on the page's origin, lazily and with no referrer; the site's initial on its hue
  when there is none), the title on one line (14/500, without the site's own name), and under it
  one muted line: `host · open 3 d`. No cover and no address line: the whole address is the
  title's tooltip and what Copy copies. Every row is the same height, selected or not.
- **A tab that is already saved** is the same row with more at its end: the link's preview
  (`CompactRowThumb`, 64×36, from `sm` up) and a `Saved` mark that opens the link's page. The page
  knows a tab is saved when its address (without fragment and trailing slash) is among the latest
  100 links, or it was saved from this page.
- **Time is the tab's own**: how long it has been open (`open 12 min`, `open 5 h`, `open 3 d`),
  from the browser's `openedAt`. A tab without it says nothing; the time of the last sync is not
  shown on rows.
- **Groups**: one per device (`Zen on Work laptop · 11 tabs · synced just now`, the sync time once
  per device), its tabs in the browser's own order, then **Stale**: the tabs of every device open
  longer than 7 days, oldest first, each naming its device. The headers are `GroupHeader`s that
  stick under the app header while their group scrolls by (`sticky`, at `--app-bar-height`) and
  fold their group (`collapsible`: the title is a 32px button with a chevron). Stale has the bulk
  actions `Save all` and `Archive all n` (the latter after a confirm).
- **No chart.** The line under the title sums the page up: `23 tabs open · 6 older than a week`.
- **Actions per row**, `ghost` `sm` at the row's end: Save (to Stash; the tab stays open), Copy
  link, Open here, and a menu with Archive (save and close) and Close on the device. They show
  under the pointer, with keyboard focus in the row and on the selected row (a click on the row,
  or ↑/↓); the text gives way to them, the row keeps its height. On a phone a swipe to the left
  brings them out (icons only, in the place of the Saved mark) and a swipe back hides them.
- **Bulk**: `Select` (or X on the selected row, or a finger held on a row) turns the icons into
  checkboxes (`CheckToggle`); the picked tabs are saved in one request from an `ActionBar` (at the
  filter's end; a bar above the nav on phones).
- **Filter**: a compact field (`sm`, 288px; the row's width on phones) over the list filters by
  title, address and device. The header's search stays the Inbox's.
- Keys: ↑/↓ select, ↵ open, S save, C copy link, X pick, E archive, W close on device.

The api reports no windows or workspaces and no last-active time for a tab yet, so the groups
stop at the device and the row's time is the time since it was opened.

### Link page (#159)

`/links/<id>` is one link at reading size, in a column at most 768px wide:

- **Back** (`secondary` `sm`): to the Inbox the page was opened from (`Inbox`, or `Results` while
  it was searching), by stepping back in the history, so its filters or search (they are in its
  URL) and its scroll position return (the router restores the scroll on the way back). Opened
  directly, it links to the Inbox.
- **Hero** (`MediaHero`): the preview image, radius 12, or the generated cover of "Media
  rows" at full size. Its box is 16:9 and never taller than `min(70vh, 640px)` (#176), so with
  the header it always fits the window. A picture of another shape (a portrait `og:image`) is
  shown whole in the middle over its blurred copy, as in a row. A video whose shape the URL
  tells (a YouTube Short is 9:16) reserves that shape: the box is as wide as the column and as
  tall as the cap allows, and the player is a centred 9:16 frame at that height on the blurred
  poster, with the play button in the middle. Fullscreen is the player's own. A YouTube link carries a play button (44px tall); pressing it, or the
  preview, swaps in the player from `youtube-nocookie.com/embed/<id>`. The `<iframe>` does not
  exist before that press, so opening the page tells YouTube nothing. The app sets no
  Content-Security-Policy, so there is nothing to allow.
- **Type and status** as one quiet outline badge above the title (`Video · New`), apart from the
  tags.
- **Title**: the page's `h1`, 28/600, three lines at most. Under it **one meta line** (`MetaLine`:
  host · channel or author · `saved 3d ago` · device) and the page's one `primary`, **Open**, which
  opens the URL in a new tab.
- **Summary** as reading text: 16/1.6 (`text-prose`), at most 65ch wide. **Tags** as chips; a tag
  opens the Inbox filtered by it.
- **Actions**: `Mark seen` `Mark done` `Archive` as `secondary` `sm` buttons with their keys
  (`S`, `D`, `E`, as in the Inbox), only those that apply to the link's status. **Delete** stands
  apart at the end of the page, `destructive`, and asks first.
- **Details**, a closed `Disclosure` near the end: saved date, language, the URL and, when it
  differs, the canonical URL, each truncated to one line with a copy button.
- **Phone**: the hero runs from one screen edge to the other without the radius, Open takes the
  full width, and the actions are a bar fixed to the bottom of the screen above the nav
  (`ActionBar`, 56px; `AppMain` pads the page's end for it).

### Post page (#170)

The page of a link to a post on X shows the post in the hero's place, the way X shows it
(`PostCard`, at most 576px wide, radius 12, a hairline border):

- **Header** (`PostByline`): a 40px round picture, the name (15/600) with the verified mark, and
  under it the @handle · the day. The name opens the author's profile.
- `Replying to @handle` for a reply, muted 13.
- **The words** (`PostText`) as reading text, 16/1.6, with their line breaks. Links (shown in
  their short form, opening the expanded address), mentions, hashtags and cashtags are accent
  links that open in a new tab. A long post says that this is its beginning.
- **Media** (`PostMedia`) in one box with radius 12: one photo or video, two side by side, three
  as one tall and two small, four as a 2×2 grid, 2px apart in a 16:9 box. **A single photo or
  video is shown whole** (#176): its box has its shape (16:9 when X gave no size, 3:1 at the
  widest) and is never taller than `min(70vh, 640px)`, so a portrait stands in the middle of the
  card's width over a blurred, darkened copy of itself, and a portrait video plays in that same
  centred frame. In a grid the cells keep their shape and a photo is cropped from its upper
  third. A photo opens the **lightbox** (`PostLightbox`): the photo as large as the
  screen allows on a 90% black backdrop, a counter, Previous / Next (36px, also ← →), and Close,
  Esc or a click beside the photo to leave. A **video** shows its poster and a play button (44px
  tall); the press puts the player in its place (an mp4 with the browser's controls; a GIF loops
  silently).
- **The quoted post** as a nested card inside: a 24px picture, name and @handle on one line, the
  words at 14, its media never taller than 16:9. Its name opens the quoted post on X.
- **A quiet last line** (`MetaLine`): time · day · replies · likes, as far as X gave them.
- Under the card, the link's own lines as on any link page: the `Post · New` badge, the meta line
  (`x.com` · saved · device), then **Open on X** as the page's `primary` with **Copy text**
  (`secondary`) beside it; on phones the two share the width. The link's title only repeats the
  post, so it is the page's `h1` for screen readers alone. A summary shows only when it is not the
  post's own words (a long post gets a written one). Tags, actions, Details and Delete follow.
- **Privacy**: every picture loads lazily with `referrerpolicy="no-referrer"`. A `<video>` has no
  such attribute, so the player is a frame whose own document sets `no-referrer` for everything
  it loads (`PostMediaItems.playerDocument`); it does not exist before the press. The frame is
  sandboxed (`sandbox="allow-scripts"`, never `allow-same-origin`), so its document has an opaque
  origin and cannot reach the app. X's video host
  refuses requests that name another site, so this is also what makes the video play.
- **A post that could not be read** (deleted, protected, or X gave no answer): the card says
  `Post unavailable` and that the link is kept; the URL, Open on X and every action stay.

### Rows

Every other list (Settings devices and tokens, Start saving, recent searches) is built
from `ListRow`: `leading` · `title` · `meta` · `trailing` on a 36px title line, then extra lines
(summary, tags) and, while selected, the action bar. A single-line row is 52px. On phones the meta
wraps under the title. Row text, section headers and the page title all start on the content edge,
and trailing controls end on it; the row's box reaches 12px past both edges so its hover, focus
and selected background has room.

### Data graphics

No page has a chart: #148 dropped the Inbox's 30-day bars and the Search timeline, which read as
decoration, and #181 the Open now age chart, whose one tick per tab said nothing. Counts are in
the page subtitle (`6 unread · 30 saved in 30 days`, `23 tabs open · 6 older than a week`). A data
graphic, if one comes back, renders only with data and real spread, with its legend directly
under or beside it.

### Search

Search is an input, not a page (#156): one field in the app header, on every page. `⌘K` / `Ctrl+K`
and `/` focus it; `esc` clears it and leaves it.

- **Typing filters in place.** The query goes to the URL of the Inbox (`/links?q=…`) once typing
  pauses (300 ms), and the Inbox's list becomes the results: the same media rows with the same
  actions and keys, ranked instead of grouped by day, with the query's terms marked in the accent
  (`MatchMark` `tone="signal"`) in titles and summaries (not in `Meaning` mode, which matches no
  words). From any other page the first query opens the Inbox. Clearing the field brings the feed
  back.
- **One line over the results**, where the Inbox has its feed switch: `12 results for “query” ·
  Hybrid ▾` (the mode as a `plain` `FilterMenu`: `Hybrid` · `Meaning` · `Keywords`) and the
  `Type`, `Device` and `Date` menus inline. A tag clicked on a row narrows the search and shows as
  one chip that clears it. On a phone the menus are a `ScrollRow` under the summary: one line
  that scrolls sideways and never wraps.
- **The URL holds the search**: `q`, `mode`, `device` and `range` next to the Inbox's own `type`
  and `tag`, so back, forward and a shared link work. A search is one history entry (starting it
  adds the entry, refining or clearing replaces it). `/search?q=…` (the extension popup, old
  links) redirects to `/links?q=…`.
- **No jump between queries.** The page header and the line stay; the last results stay on screen
  (the line is `aria-busy`) until the next answer arrives. A skeleton shows only for a first
  answer that takes over 150 ms (see "Loading states").
- **Recent searches** (the last 6 of the 8 kept) hang under the focused, empty field
  (`FieldPopup`); each can be run again (click, or `↑`/`↓` and `↵`) or removed. They stay in the
  browser (`localStorage` through `@stash/web-platform/recent-searches`) and are never sent to the
  api. A search is remembered when the user acts on it: `↵` in the field, or opening a result.
- `↵` or `↓` in the field hands the keys to the results: `↑`/`↓` select, `↵` opens, `S` / `D` /
  `E` as in the Inbox.

### Settings

One page with three sections, in this order (#156 merged the Connect page into it):

1. **Devices & connections** (`#connections`): one row per source (iPhone / iPad, Zen, Mac,
   Claude) with its status and a guide that opens in place (`/settings?guide=iphone`), then the
   devices they registered, each with New token. `/connect` and `/connect?guide=…` redirect here
   with the guide open; `/connect/extension?code=…` is still the page the extension opens to be
   approved.
2. **API tokens**: every token, with Revoke.
3. **Appearance**: the theme.

### App header

One quiet row, with the same max width (960px) and side padding as `<main>`, 56px tall, sticky,
hairline below.

- Left: the logo (`<Wordmark>`: the 28px Well mark and `stash`, see "Logo"), then the nav as plain text tabs (Inbox, Open now, Settings) with a 2px
  underline on the active one, no tray and no borders.
- Right, before the account button: **the search field** (`<AppBarSearch>`, a `sm` `SearchField`
  with a `⌘K` keycap), compact: 300px wide. While it has the focus it is 480px (or what the row
  has left), growing to the left into the free space of its own place, so the nav and the account
  button never move. It is the only Search entry point; see "Search".
- **The tabs answer at once** (#167). The code and the first data of every tab load when the app
  is idle (one read per tab; a phone has no hover), and the pointer, a finger or the focus on a tab
  asks for its data again when the answer is older than 1.5 s (`ApiAtoms.prefetch`; the page that
  opens right after doesn't ask twice, and a change made on another device shows on the way back) (`preload` / `prefetch` of the
  feature's `./routes`, through `src/app-prefetch.ts`). A tab that was open paints from its cached
  data in the first frame and refreshes behind it, without a skeleton; the tab is marked from the
  click on, also while a page still loads its code; and each tab opens where it was left (its
  scroll position), unless it opens at another address (a filter, a search).
  `pnpm --filter @stash/web check:tab-switch` holds the built app to it: under 100 ms from the
  click to the painted rows, no skeleton, a refresh behind, the scroll kept.
- Right: **one account menu button** (the login's initial on a round avatar) holding the theme
  switch (System / Light / Dark as radio items), the sync status and Sign out. An 8px accent dot on
  the button appears only when offline; otherwise the status stays in the menu.
- Every icon-only control has an accessible name (`aria-label`) and a tooltip (`title`).

### Loading states (#167)

Nothing moves when data arrives.

- **A skeleton is the real layout with placeholder blocks**, not a drawing of it: rows are
  `<MediaRowSkeleton>` (the real `<MediaRow>`: 114px from `sm` up, 120px on phones with a tags
  line, 88px without), `<CompactRowSkeleton>` (the real `<CompactRow>`, 48px: open tabs) and
  `<ListRowSkeleton>` (the real `<ListRow>`), a group is
  `<GroupHeader placeholder>` (with `collapsible` where the group's header is), and `<Skeleton>` has a shape with the box of everything else (a
  line of text, the page title, a badge, a 16:9 hero, a field, a chip, a row's icon). They sit in the
  same containers and gaps as the loaded page.
- **It shows after 150 ms and then stays at least 300 ms** (`useDelayedLoading`), so a fast answer
  never shows one and a slow one never flashes it. Cached data shows at once.
- **The frame of a page is the same in every state**: loading, loaded, empty and failed. The page
  header keeps the line of its counts (`subtitle=""` until they are there) and its action; the
  Inbox keeps its filters over the first-run card; empty and error states stand where the list
  does. In Settings the lists hold their rows' place before the skeleton shows, and the sections
  under the devices (API tokens, Appearance) come in with the data, at their place, because the
  number of devices decides where they start.
- **Images are sized before they load**: a row's preview is 160×90 (110×62), a hero is 16:9 (or
  the shape its link tells) with its height capped. A picture whose shape is only known once it
  has loaded changes how it sits inside that box, never the box.
- What the skeleton can't know is the data: how many tabs the first device has (the next group
  starts after them), how many lines a link's title takes.
  There the content replaces the skeleton in one frame; nothing that was on screen moves.

`pnpm --filter @stash/web check:loading` (after a build; CI job `layout-audit`) opens the Inbox,
Open now, a link's page and Settings on the built app with an api that takes 800 ms, at 1440 and
390 wide, and fails when a part of a skeleton is more than 1px off the box of what replaces it
(the first rows and their previews, the page header, the filters, the hero) or when the page's
Cumulative Layout Shift is over 0.01; the first-run pages are held to the same limit. With
`--screenshots` it writes each page while loading and once loaded to
`docs/screenshots/loading-<page>-<width>-skeleton.png` and `-loaded.png`.

### Phone (< 640px)

- No horizontal scroll at 390px on any page.
- The nav moves to a **bottom bar**: the same text tabs, full width, fixed above the home indicator
  (`env(safe-area-inset-bottom)`). `<main>` pads its bottom so content clears it.
- The header keeps the wordmark and the account button, and the search field takes a full-width
  line under them (without the `⌘K` keycap).
- Keyboard shortcut footers are hidden.
- A row of chips stays on one line and scrolls on its own, out to the edge of the screen.

### Screenshots

`pnpm --filter @stash/web screenshots` boots the api under `alchemy dev` (stage `screenshots`, no
credentials), seeds synthetic data and a session through the dev-only `/_smoke/seed` and
`/_smoke/session` routes, runs Vite against it and captures every page (Inbox with a selected row, Inbox while searching
(`inbox-search-*`), the focused empty search field with recent searches (`inbox-search-recent-*`),
the app header alone with the search field at rest and focused (`header-*`, `header-focused-*`),
Open now five times, with its tabs from the audit's fixtures (`open-now`: three devices, a stale group
and saved tabs; `open-now-many`: one browser with a long list; `open-now-two-devices`;
`open-now-selected`: a row with its actions; `open-now-picking`: tabs picked for a bulk save), the `/save` result, a link's page three times (`link-youtube`, `link-article`,
`link-cover`, answered in the browser from the audit's fixtures), a post on X of each kind
(`post-text`, `post-photo`, `post-photos`, `post-video`, `post-quote`, `post-unavailable`), a photo opened
large (`post-lightbox`) and the Inbox with posts among its links (`inbox-posts`), from the same fixtures, Settings, Settings with each guide open (`settings-iphone-*` and so
on), the extension's approve page, Login, `/_ui`) in dark and light at 1440×900 and 390×844 into
[`docs/screenshots/`](screenshots/). Inbox, Open now and Settings are also captured as a
first-run user with no data (`inbox-empty-light-desktop.png` and so on), with the browser answering
the data requests with empty results. Before each capture the viewport grows to the page's height,
so the phone's bottom nav sits at the bottom of the picture as on a screen. Pages are cut at
2000px, except `/_ui`, which is captured whole. It fails when a page
scrolls sideways or a button has no accessible name. Chromium needs its system libraries
(`pnpm --filter @stash/web exec playwright install-deps chromium` once per machine).

### Logo

The logo is the **Well**: a dark tactile squircle with three steps sinking toward a glowing orange
core, next to the wordmark `stash` in Geist 600 with letter-spacing -0.05em. The mark is dark in
both themes.

- **Sources:** two SVGs in the kit, `packages/web/ui/src/logo/stash-mark.svg` (full, three steps)
  and `stash-mark-sm.svg` (one step and the core, drawn for 32 and 16 px). Each stands alone (no
  external references), and their ids carry different prefixes (`stash-well-…`,
  `stash-well-sm-…`), so both can be inlined in one page.
- **In the web app:** `<LogoMark>` (an `<img>`; `sm` 28 and `md` 44 use the small mark, `lg` 96 the
  full one) and `<Wordmark>` (mark + word: `md` in the app bar, `xl` on the login screen).
- **Rasters are drawn, never exported by hand.** `pnpm --filter @stash/web icons`
  (`apps/web/scripts/brand-icons.ts`) writes `favicon.svg`, the 32/16 favicons, the 180 px
  `apple-touch-icon` and the 192/512 manifest icons (the full mark on an opaque square of its body
  colour, plus a maskable 512 with the mark inside the safe zone), and
  `docs/screenshots/brand-icons.png` to check the small sizes by eye.
  `pnpm --filter @stash/extension icons` writes the extension's 16/32 (small mark) and 48/96/128
  (full mark).
- **Copies:** contexts share no code, so the extension keeps copies of both SVGs
  (`apps/extension/assets/`) and the MCP sign-in pages an inline copy of the small one
  (`apps/mcp/src/stash-mark.ts`). After changing a mark, update the copies and run both scripts.

## Layout audit

`pnpm --filter @stash/web audit:layout` (CI job `layout-audit`) builds the app, serves it with
`vite preview` and opens every page in headless Chromium, one at a time: Inbox, Open now and
Settings, each seeded and as a first-run user, Inbox and Open now with a selected row, Open now
with tabs picked, with one long list and with two devices, the Inbox
while searching, the search field's recent searches, Settings with each guide open, the
extension's approve page, `/save`, a link's page (a YouTube video, an article with an image, a
link with none, a YouTube Short, an article with a portrait image), a post of each kind (among
them a portrait video, a portrait photo, a square and a panorama), plus Login, in the light theme at 1440 and 390 wide. The api is answered in the browser from synthetic fixtures
(`apps/web/scripts/layout-fixtures.ts`), and the fixtures' preview images are drawn in
`scripts/preview-images.ts`, so nothing is fetched from the network. On each page it checks:

- every visible `button`, `input` (by its field box), `[role=tab]`, `[role=menuitem]`,
  `[role=radio]` and `a[data-row]` is 32, 36 or 44 tall, and on phones has a hit area of at least 44;
  a media row's title is checked for the hit area only (its target is the whole row), and a tag
  chip on a row is not a control;
- controls on one row share their height and vertical centre;
- every page-level block starts on the content edge (± 0.5px), trailing controls end on it, rows
  inside a card share one edge, and every line of a row starts where its title does (on a phone a media row's tags
  and action bar run under the preview too and are not such lines); a media row
  is measured by its box, which must sit on both content edges (or, where its background reaches
  past them, as for a selected row on a phone, by its content); a `ScrollRow`, which on a phone
  runs off both screen edges, is measured by its content box a `MediaHero` that spans the
  whole screen on a phone counts as on the edges;
- every media row on a page is the same height (± 1px), except the selected one, which adds its
  action bar; so is every compact row (open tabs: 48px, selected, saved or neither); the seeded Inbox mixes a video with no summary, an article with one, a title too
  long for its line and links with no image or no tags;
- a link page's preview (`MediaHero`) and a post's media (`PostMedia`) are never taller than the
  window minus the header (#176);
- every vertical gap between page-level blocks is on the spacing scale;
- text renders in mono only inside keys and the device code.

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
| CompactRow | `compact-row` (48px at every width; slots `leading`, `title`, `meta`, `trailing`, `actions`: out under the pointer, with keyboard focus, while `selected` or `revealed`; emits `update:revealed` on a touch swipe and `hold` on a held finger), `compact-row-title` (14/500, one line), `compact-row-thumb` (64×36 preview at the row's end), `compact-row-skeleton`, `site-icon` (a site's favicon at 20px, its initial without one), `check-toggle` (a 16px checkbox in a 32px target, `v-model:checked`, `label`) |
| MediaRow | `media-row` (one fixed height; slots `thumb`, `title`, `meta`, `summary`, `tags`, `#actions` while `selected`; `unread`), `media-row-title` (15/600, one line, two on phones, the whole row's target unless `:stretch="false"`), `site-title` (a title without the site's own name), `tag-line` (the tags on one line: as many chips as fit, then `+n`), `media-thumb` (16:9, 160×90, 110×62 on phones; a generated cover from `url` without an image or when it fails to load: host-hued gradient, favicon, host; `video`), `site-cover` (the cover's host, favicon URL and hue), `tag-chip` (24px); text role `text-row-title` |
| MediaHero | `media-hero` (`src`, `url`, `embed`, `title`, `aspect`): a link's preview on its own page, at most `min(70vh, 640px)` tall, with a play button that loads the player on demand |
| MediaFit | `media-fit` (`src`, `aspect`, `box`, `fit`: a remote picture in a box of any shape, filling it from the upper third or whole over its blurred copy; the default slot is drawn in the picture's frame), `media-shape` (ratios, the 1.3–2.1 limits, the height cap); used by `media-thumb`, `media-hero` and `post-media`, never an `<img>` with `object-fit` of its own |
| Post | `post-card` (the surface; `nested` for a quoted post), `post-byline` (`row` / `card` / `quote`: picture, name, verified mark, @handle, a `meta` slot; `href`), `post-text` (words with their links; `prose` / `body`; `post-text-parts` cuts them), `post-media` (1–4 photos and videos in one box, a lightbox for photos, a video that plays in a `no-referrer` frame; `compact`; `post-media-items` has the types and the player's document), `avatar` (a round picture, 16 / 24 / 40 / 48, the initial without one); `media-row` `meta-first` and `media-row-title` `:lines="2"` for a post's row, `media-thumb` `avatar` for its cover |
| MetaLine | `meta-line`: the dot-separated meta line outside a row |
| ActionBar | `action-bar` (`label`): an item's actions, a bottom bar on phones |
| ScrollRow | `scroll-row`: a row of controls that wraps from `sm` up and is one sideways-scrolling line on phones, running off both screen edges |
| GroupHeader | `group-header` (`title`, `count`, `meta`, `#actions`): 13/600 uppercase with a rule, above a group of rows; `collapsible` with `v-model:open` folds the group from its title, `sticky` keeps it under the app header |
| MatchMark | `match-mark` (`tone`: `surface` on muted text, `signal` on full-contrast text) |
| Card | `card`, `card-header`, `card-title`, … |
| Avatar | `avatar-button` |
| App shell | `app-frame`, `app-bar`, `app-bar-search`, `app-main`, `nav-bar`, `nav-tab`, `wordmark` (the logo: mark and word; `size` `md`, `xl`), `logo-mark` (`size` `sm` 28, `md` 44, `lg` 96), `centered-screen` |
| PageHeader | `page-header` (`title`, `subtitle`, `#actions`): the page's `h1` |
| SectionHeader | `section-header` (`title`, `count`, `#actions`) |
| Link | `text-link` |
| Menu | `dropdown-menu*`, with `dropdown-menu-radio-group` / `dropdown-menu-radio-item` for a choice (the theme switch in the account menu, `filter-menu`) |
