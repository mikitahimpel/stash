/** What a tag line measured, in CSS pixels. */
export interface Measured {
  /** The width of the line. `0` where nothing is laid out (a test without a browser). */
  readonly line: number;
  /** The widths of the candidate chips, in order. */
  readonly chips: ReadonlyArray<number>;
  /** The width of the `+N` chip, when it was on the line. */
  readonly more: number | undefined;
  /** How many tags there are, shown or not. */
  readonly total: number;
  /** The space between two chips. */
  readonly gap: number;
}

/** The `+N` chip when it was not on the line to be measured: `+9` at 13px in a 24px chip. */
const moreWidth = 36;

/**
 * How many of the candidate chips fit on the line, leaving room for the `+N` chip whenever a tag
 * is left out. Every candidate when the line has no width, so a page without layout shows them.
 */
export const count = (measured: Measured): number => {
  const { chips, gap, total } = measured;
  if (measured.line <= 0) return chips.length;
  const more = measured.more ?? moreWidth;
  let used = 0;
  let fits = 0;
  for (let n = 1; n <= chips.length; n++) {
    used += chips[n - 1]! + (n > 1 ? gap : 0);
    const rest = n < total ? gap + more : 0;
    if (used + rest > measured.line) break;
    fits = n;
  }
  return fits;
};
