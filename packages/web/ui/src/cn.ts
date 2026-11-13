import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The kit's own tokens (styles.css): text roles are font sizes, not colors, and the control
// heights and radii are sizes, so a later `text-foreground` must not drop `text-label`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["title", "label", "body", "meta", "key", "chart"],
      spacing: ["control-sm", "control-md", "control-lg"],
      radius: ["control", "surface"],
    },
  },
});

/** Joins class values and lets later Tailwind utilities override earlier conflicting ones. */
export const cn = (...inputs: ReadonlyArray<ClassValue>): string => twMerge(clsx(inputs));
