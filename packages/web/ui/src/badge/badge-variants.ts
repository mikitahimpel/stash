import { cva, type VariantProps } from "class-variance-authority";

/**
 * Quiet mono labels: hierarchy comes from spacing, not fills. `default` and `secondary` are plain
 * metadata, `outline` adds a hairline border, `destructive` uses the destructive color.
 */
export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-[5px] border px-1.5 py-px font-mono text-xs transition-colors [&>svg]:pointer-events-none [&>svg]:size-3",
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
