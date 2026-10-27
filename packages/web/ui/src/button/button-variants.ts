import { cva, type VariantProps } from "class-variance-authority";

/**
 * `raised` (the default) is the everyday key, `primary` the one main action of a view, `ghost` a
 * quiet action inside rows and toolbars. The other variants are kept for existing callers:
 * `default`, `outline` and `secondary` render as `raised`, `destructive` is a raised key with
 * destructive text, and `link` is a text link.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-[background,box-shadow,color,transform] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        raised: "tactile-raised",
        primary: "tactile-primary",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent",
        default: "tactile-raised",
        outline: "tactile-raised",
        secondary: "tactile-raised",
        destructive: "tactile-raised text-destructive",
        link: "px-0 text-foreground link-underline has-[>svg]:px-0",
      },
      // Controls are at least 34px; phones get 40px touch targets.
      size: {
        default: "h-10 px-3.5 has-[>svg]:px-3 sm:h-9",
        sm: "h-10 gap-1.5 px-3 has-[>svg]:px-2.5 sm:h-[34px]",
        lg: "h-11 px-5 has-[>svg]:px-4 sm:h-10",
        icon: "size-10 sm:size-9",
      },
    },
    compoundVariants: [{ variant: "link", class: "h-auto px-0 sm:h-auto" }],
    defaultVariants: {
      variant: "raised",
      size: "default",
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
