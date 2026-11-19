// A link that arrives live (saved a moment ago on another device) takes its place in the list,
// and everything under it has to make room. Moved at once, that is a layout shift: the row the
// reader is on jumps. So the parts under the new row are first drawn where they were (a
// `transform` that undoes the move) and then slide to where they belong: nothing jumps, and the
// browser counts no layout shift, because what was on screen is still where it was.
//
// When the reader has scrolled down, the browser keeps the view itself (scroll anchoring) and
// nothing here moves.

/** The parts of the page that are moved one by one: the leaves, so no move counts twice. */
export const parts = "[data-slot=link-row], [data-slot=group-header], [data-keep-place]";

/** How long a part takes to slide to its place, in ms. */
export const slideMillis = 220;

/**
 * Whether `now` is `before` with links put in above its last one: every link is still there, in
 * the same order, and a new one stands before the end. A next page appended at the end, a link
 * that left, a different list and a first load are not.
 */
export const isInsert = (before: ReadonlyArray<string>, now: ReadonlyArray<string>): boolean => {
  if (before.length === 0 || now.length <= before.length) return false;
  let kept = 0;
  let above = false;
  for (const id of now) {
    if (id === before[kept]) kept++;
    else if (kept < before.length) above = true;
  }
  return kept === before.length && above;
};

/** Where each part under `root` stands now: its top on the screen. */
export const measure = (root: Element): Map<Element, number> => {
  const tops = new Map<Element, number>();
  for (const part of root.querySelectorAll(parts)) tops.set(part, part.getBoundingClientRect().top);
  return tops;
};

/**
 * After the list changed: draws each part that moved since `before` where it was, then lets it
 * slide to its place. A part that is new has no place to come from and just appears.
 */
export const slide = (root: Element, before: ReadonlyMap<Element, number>): void => {
  const moved: Array<HTMLElement> = [];
  for (const part of root.querySelectorAll<HTMLElement>(parts)) {
    const was = before.get(part);
    if (was === undefined) continue;
    const by = was - part.getBoundingClientRect().top;
    if (Math.abs(by) < 1) continue;
    part.style.transition = "none";
    part.style.transform = `translateY(${by}px)`;
    moved.push(part);
  }
  if (moved.length === 0) return;
  // The browser takes the starting position in before the slide begins.
  void root.getBoundingClientRect();
  for (const part of moved) {
    part.style.transition = `transform ${slideMillis}ms ease-out`;
    part.style.transform = "";
  }
  setTimeout(() => {
    for (const part of moved) part.style.transition = "";
  }, slideMillis + 50);
};
