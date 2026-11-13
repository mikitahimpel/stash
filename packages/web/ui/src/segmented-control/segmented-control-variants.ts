import { cva, type VariantProps } from "class-variance-authority";
import { controlSizes, controlSurfaces } from "../control/control-variants";

/**
 * A sunken track as tall as any other control of its size. Each segment fills the track's full
 * height (its box is a 32 / 36 control) and the active one shows a raised thumb inset by 3px.
 */
export const segmentedControlVariants = cva(
  `inline-flex shrink-0 items-stretch rounded-control ${controlSurfaces.sunken}`,
  {
    variants: {
      size: {
        sm: controlSizes.sm.split(" ")[0],
        md: controlSizes.md.split(" ")[0],
      },
    },
    defaultVariants: { size: "md" },
  },
);

export const segmentedControlItemVariants = cva(
  "relative hit-area -my-px inline-flex items-center justify-center whitespace-nowrap rounded-control px-3 text-label transition-colors first:-ml-px last:-mr-px",
  {
    variants: {
      active: {
        true: "text-foreground",
        false: "text-muted-foreground hover:text-foreground",
      },
    },
    defaultVariants: { active: false },
  },
);

/** The raised thumb behind the active segment's label. */
export const segmentedControlThumb = `pointer-events-none absolute inset-[3px] rounded-[5px] ${controlSurfaces.raised}`;

export type SegmentedControlVariants = VariantProps<typeof segmentedControlVariants>;
