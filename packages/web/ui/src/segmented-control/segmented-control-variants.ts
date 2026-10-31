import { cva, type VariantProps } from "class-variance-authority";

/**
 * The look of `<SegmentedControl />`: a small sunken tray whose active segment is a raised key,
 * 32px tall (40px touch target on phones).
 */
export const segmentedControlVariants = cva(
  "inline-flex h-10 items-stretch gap-0.5 rounded-lg p-[3px] tactile-sunken sm:h-8",
);

export const segmentedControlItemVariants = cva(
  "inline-flex items-center justify-center rounded-md border border-transparent px-3 text-[13px] font-medium whitespace-nowrap transition-[background,box-shadow,color]",
  {
    variants: {
      active: {
        true: "tactile-raised",
        false: "text-muted-foreground hover:text-foreground",
      },
    },
    defaultVariants: { active: false },
  },
);

export type SegmentedControlItemVariants = VariantProps<typeof segmentedControlItemVariants>;
