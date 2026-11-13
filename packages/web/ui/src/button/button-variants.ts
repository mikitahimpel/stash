import { cva, type VariantProps } from "class-variance-authority";
import {
  controlBase,
  controlIconSizes,
  controlSizes,
  controlSurfaces,
} from "../control/control-variants";

/**
 * `raised` (the default) is the everyday key, `primary` the one main action of a screen, `ghost`
 * and `secondary` quiet actions in rows, section headers and toolbars (`secondary` is a raised
 * key), `destructive` a raised key with destructive text. Sizes are the control heights: `sm` 32,
 * `md` 36 (default), `lg` 44, and `icon-sm` / `icon` / `icon-lg` squares of the same heights.
 */
export const buttonVariants = cva(controlBase, {
  variants: {
    variant: {
      raised: controlSurfaces.raised,
      primary: controlSurfaces.primary,
      ghost: controlSurfaces.ghost,
      secondary: controlSurfaces.raised,
      destructive: `${controlSurfaces.raised} text-destructive`,
    },
    size: {
      sm: controlSizes.sm,
      md: controlSizes.md,
      lg: controlSizes.lg,
      "icon-sm": controlIconSizes.sm,
      icon: controlIconSizes.md,
      "icon-lg": controlIconSizes.lg,
    },
  },
  defaultVariants: { variant: "raised", size: "md" },
});

export type ButtonVariants = VariantProps<typeof buttonVariants>;
