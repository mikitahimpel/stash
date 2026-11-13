import { cva, type VariantProps } from "class-variance-authority";

/**
 * Quiet sans labels (13/400): hierarchy comes from spacing, not fills. `default` and `secondary`
 * are plain metadata, `outline` adds a hairline border, `destructive` uses the destructive color.
 */
export const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border px-1 text-meta transition-colors [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent text-foreground [a&]:hover:bg-accent",
        secondary: "border-transparent text-muted-foreground [a&]:hover:text-foreground",
        destructive: "border-transparent text-destructive [a&]:hover:bg-accent",
        outline: "border-hairline text-muted-foreground [a&]:hover:text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeVariants = VariantProps<typeof badgeVariants>;
