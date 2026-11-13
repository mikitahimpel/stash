/**
 * The one control language of the kit (docs/design.md, "Tokens"). Every interactive primitive
 * (Button, Input, SearchField, SegmentedControl, ToggleChip, FilterMenu, Tabs, the avatar) takes
 * its height, radius, border, label type and phone hit area from here, so they can't drift apart.
 */

/** Shape and type shared by every control: radius 8, a 1px border, 14/500 labels, hit area. */
export const controlBase =
  "relative hit-area inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-control border text-label transition-[background,box-shadow,color,transform] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

/**
 * `raised`: keys, menu triggers, the segmented thumb, a chip that is on. `primary`: the one main
 * action of a screen. `sunken`: fields, the segmented track, a chip that is off. `ghost`: quiet
 * row and toolbar actions (its border is transparent, so it keeps the same box).
 */
export const controlSurfaces = {
  raised: "tactile-raised",
  primary: "tactile-primary",
  sunken: "tactile-sunken text-foreground",
  ghost: "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
} as const;
export type ControlSurface = keyof typeof controlSurfaces;

/** Heights 32 / 36 / 44. On phones the hit area grows to at least 44 either way. */
export const controlSizes = {
  sm: "h-control-sm gap-1.5 px-3",
  md: "h-control-md gap-2 px-3",
  lg: "h-control-lg gap-2 px-4",
} as const;
export type ControlSize = keyof typeof controlSizes;

/** Square icon-only controls, one per height. */
export const controlIconSizes = {
  sm: "size-control-sm",
  md: "size-control-md",
  lg: "size-control-lg",
} as const;
