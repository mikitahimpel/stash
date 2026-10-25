# @stash/web-ui

Presentational components for the web context: shadcn-vue components on top of
[reka-ui](https://reka-ui.com), styled with Tailwind CSS v4. No feature logic and no app state.

## Tailwind preset

`apps/web` imports the preset once from its main stylesheet:

```css
@import "@stash/web-ui/styles.css";
```

It brings in Tailwind, `tw-animate-css`, the theme tokens (`bg-background`, `text-muted-foreground`,
`border-input`, …) and an `@source` for this package, so the app build picks up the kit's classes.

- **Dark mode** follows the `dark` class on `<html>` (`dark:` utilities and the tokens switch with
  it). The app decides when to set it.
- **Mobile-first**: unprefixed utilities target phones, and `sm:` / `md:` / `lg:` widen the layout.
  Controls are a little taller below `sm` for touch.

## Components

Each `.vue` file is its own export, so there is no barrel: `import Button from "@stash/web-ui/button"`.

| Component | Exports |
|---|---|
| button | `button`, `button-variants` |
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
- Tests cover behaviour only (open/close, selection, tab switching, toast dismissal, conditional
  slots) plus a compile check of the Tailwind preset.
