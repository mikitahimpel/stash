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
- **Mobile-first**: unprefixed utilities target phones, and `sm:` / `md:` / `lg:` widen the layout.
  Controls are a little taller below `sm` for touch.

## Components

Each `.vue` file is its own export, so there is no barrel: `import Button from "@stash/web-ui/button"`.

| Component | Exports |
|---|---|
| button | `button`, `button-variants` (`raised` default, `primary`, `ghost`; `outline`, `secondary`, `destructive`, `link` kept for older callers) |
| segmented-control | `segmented-control` (radio group, `v-model`, arrow keys move the selection), `segmented-control-option` (type) |
| toggle-chip | `toggle-chip` (`v-model:pressed`, sets `aria-pressed`) |
| search-field | `search-field` (sunken input, `v-model`, optional `shortcut` keycap) |
| kbd | `kbd` (keycap) |
| list-row | `list-row` (`selected`, `#actions` slot shown while selected) |
| section-header | `section-header` (`title`, `count`, `as`, `#actions` slot) |
| text-link | `text-link` (`as-child` for `<RouterLink>`) |
| input | `input` (`v-model`) |
| badge | `badge`, `badge-variants` |
| card | `card`, `card-header`, `card-title`, `card-description`, `card-content`, `card-footer` |
| dialog | `dialog`, `dialog-trigger`, `dialog-content`, `dialog-header`, `dialog-footer`, `dialog-title`, `dialog-description`, `dialog-close` |
| dropdown-menu | `dropdown-menu`, `dropdown-menu-trigger`, `dropdown-menu-content`, `dropdown-menu-item`, `dropdown-menu-label`, `dropdown-menu-separator` |
| tabs | `tabs`, `tabs-list`, `tabs-trigger`, `tabs-content` |
| toast | `toaster`, `toast-message` (type) |
| skeleton | `skeleton` |
| empty-state | `empty-state` (`title`, `description`, `#icon`, `#action` slots) |

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
