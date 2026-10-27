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
- Search: a 12-month timeline (month labels in mono), every saved link a small neutral dot, matches as accent dots numbered by rank.

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
| SectionHeader | `section-header` (`title`, `count`, `#actions`) |
| Link | `text-link` |
