import { controlBase, controlSurfaces } from "./control-variants";

/**
 * A text field is a sunken control: the wrapper carries the box (and the phone hit area), the
 * `<input>` inside is bare. The focus ring moves to the wrapper, so it frames the whole field.
 */
export const fieldWrapper = [
  controlBase,
  controlSurfaces.sunken,
  "w-full min-w-0 shrink cursor-text justify-start text-muted-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring/40 has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-50 has-[input[aria-invalid=true]]:border-destructive",
].join(" ");

export const fieldInput =
  "h-full min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground selection:bg-foreground selection:text-background [&::-webkit-search-cancel-button]:hidden";
