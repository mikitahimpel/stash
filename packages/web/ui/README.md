# @stash/web-ui

Presentational components for the web context: the "Stash tactile" design system
([docs/design.md](../../../docs/design.md)), built on [reka-ui](https://reka-ui.com) and styled with
Tailwind CSS v4. No feature logic and no app state.

## Tailwind preset

`apps/web` imports the preset once from its main stylesheet:

```css
@import "@stash/web-ui/styles.css";
```

It brings in Tailwind, `tw-animate-css`, self-hosted Geist and Geist Mono (`font-sans`, `font-mono`),
the theme tokens and an `@source` for this package, so the app build picks up the kit's classes.

- **Tokens**: `background`, `surface`, `foreground`, `muted-foreground`, `hairline`, `hairline-row`
  and `signal` (the spec's accent: stale / unread / match marks only) as Tailwind colors
  (`bg-surface`, `border-hairline-row`, `text-signal`, …). The shadcn names (`card`, `popover`,
  `primary`, `muted`, `accent`, `border`, `input`, `ring`, `destructive`) stay as aliases.
- **Tactile utilities**: `tactile-raised`, `tactile-primary`, `tactile-sunken`, `tactile-pressed`,
  `tactile-key`, `tactile-row-selected` and `link-underline`. They carry their own hover / active
  states.
- **Focus**: every focusable element gets a 2px ring in the foreground at 40% (`:focus-visible`).
  Don't remove it.
- **Dark mode** follows the `dark` class on `<html>` (`dark:` utilities and the tokens switch with
  it). `:root` holds the light theme. `@stash/web-platform/theme` sets the class.
- **Control tokens** (one control language, docs/design.md "Tokens"): heights `h-control-sm|md|lg`
  (32 / 36 / 44), radii `rounded-control` (8) and `rounded-surface` (12), text roles `text-title`,
  `text-label` (14/500), `text-body` (14/400), `text-meta` (13/400), `text-key` and `chart-text`
  (mono, keys and chart axes only). `hit-area` grows a control's hit area to 44px on phones without
  changing how it looks. `src/control/control-variants.ts` (`./control-variants`) holds the shared
  base, surfaces (`raised`, `primary`, `sunken`, `ghost`) and sizes every control is built from.
- **Mobile-first**: unprefixed utilities target phones, and `sm:` / `md:` / `lg:` widen the layout.

## Components

Each `.vue` file is its own export, so there is no barrel: `import Button from "@stash/web-ui/button"`.

| Component | Exports |
|---|---|
| button | `button`, `button-variants` (`raised` default, `primary`, `ghost`, `secondary`, `destructive`; sizes `sm` / `md` / `lg` and `icon-sm` / `icon` / `icon-lg`) |
| control | `control-variants` (the base, surfaces and sizes of every control) |
| input | `input` (`v-model`, `size`, `mono`; the box is a wrapper, attributes go to the `<input>`) |
| search-field | `search-field` (`v-model`, `size`, optional `shortcut` keycap) |
| segmented-control | `segmented-control` (radio group, `v-model`, `size` `sm` / `md`, arrow keys move the selection), `segmented-control-option` (type) |
| toggle-chip | `toggle-chip` (`v-model:pressed`, `size`, sets `aria-pressed`; sunken off, raised on) |
| filter-menu | `filter-menu` (`Type: Any ▾`, a raised menu trigger, `size`) |
| tabs | `tabs`, `tabs-list`, `tabs-trigger`, `tabs-content` (the segmented look) |
| avatar | `avatar-button` (32px round, `initial`, `alert`) |
| kbd | `kbd` (keycap) |
| badge | `badge`, `badge-variants` |
| list-row | `list-row` (slots `leading`, `title`, `meta`, `trailing`, default for extra lines, `actions` while `selected`), `list-row-title` (`as-child` for a link, `muted`) |
| section-header | `section-header` (`title`, `count`, `as`, `#actions` slot) |
| page-header | `page-header` (`title`, `subtitle`, `#actions` slot) |
| card | `card`, `card-header`, `card-title`, `card-description`, `card-content`, `card-footer` |
| dialog | `dialog`, `dialog-trigger`, `dialog-content`, `dialog-header`, `dialog-footer`, `dialog-title`, `dialog-description`, `dialog-close` |
| dropdown-menu | `dropdown-menu`, `dropdown-menu-trigger`, `dropdown-menu-content`, `dropdown-menu-item`, `dropdown-menu-label`, `dropdown-menu-separator`, `dropdown-menu-radio-group`, `dropdown-menu-radio-item` |
| toast | `toaster`, `toast-message` (type) |
| skeleton | `skeleton` (`shape`: `line`, `title`, `row`, `control`, `chip`, `chart`) |
| empty-state / error-state | `empty-state` (`title`, `description`, `#icon`, `#action`), `error-state` |
| app shell | `app-frame`, `app-bar`, `app-main`, `nav-bar`, `nav-tab`, `nav-shortcut`, `wordmark`, `centered-screen` |
| other | `device-code`, `status-dot`, `match-mark`, `text-link` (prose links only), `color-swatch` |

`cn` merges class lists so that a `class` passed by the caller overrides the defaults.

## Toasts

The kit keeps no toast state. The app owns the list (for example in an atom), renders
`<Toaster :toasts="toasts" @dismiss="remove" />` once, and removes a message when `dismiss` fires
(close button, swipe or timeout).

## Notes

- `tsconfig.json` adds `vueCompilerOptions.dataAttributes: ["data-*"]`, because `strictTemplates`
  rejects unknown attributes and the components mark their parts with `data-slot`.
- Tests cover behaviour only (open/close, selection, keyboard, tab switching, toast dismissal,
  conditional slots) plus a compile check of the Tailwind preset and a WCAG contrast check of
  every text / background token pair in both themes (`test/contrast.test.ts`, which reads the hex
  tokens from `styles.css`: keep color tokens as `#rrggbb`).
- `apps/web` shows every component in every state at `/_ui` in dev.
