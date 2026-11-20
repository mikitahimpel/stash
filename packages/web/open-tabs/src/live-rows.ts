import type * as OpenTabsView from "./open-tabs-view.ts";

// Open now changes while it is read: a device reports a tab it opened or closed (`tabs.updated`),
// and the rows change in place. Nothing may jump (#182):
//
// - A tab that closed stays where it was for a moment and fades out (a `leaving` row), so the
//   reader sees it go instead of the rows under it jumping up at once.
// - When rows come or go, the rows, labels and headers under them are first drawn where they were
//   (a `transform` that undoes the move) and then slide to their place. What was on screen is
//   still where it was, so the browser counts no layout shift.

/** A row that left the data and still shows, fading, at its old place. */
export interface Leaving {
  readonly tab: OpenTabsView.TabRow;
  /** The group and the window part it was in, and its place there. */
  readonly sectionId: string;
  readonly partId: string;
  readonly index: number;
}

/** Where each row stands in `sections`: its group, its part and its place there, by row key. */
export const places = (sections: ReadonlyArray<OpenTabsView.Section>): Map<string, Leaving> => {
  const at = new Map<string, Leaving>();
  for (const section of sections) {
    for (const part of section.windows) {
      part.tabs.forEach((tab, index) =>
        at.set(tab.key, { tab, sectionId: section.id, partId: part.id, index }),
      );
    }
  }
  return at;
};

/** The rows of `before` that are not in `now`, where they were. */
export const left = (
  before: ReadonlyArray<OpenTabsView.Section>,
  now: ReadonlyArray<OpenTabsView.Section>,
): ReadonlyArray<Leaving> => {
  const kept = places(now);
  return [...places(before).values()].filter((place) => !kept.has(place.tab.key));
};

/**
 * `sections` with the `leaving` rows put back at their old places (clamped to the part's end). A
 * row whose part is gone goes to the end of its group's last part; a row whose group is gone (the
 * device's last tab closed) is not shown again.
 */
export const withLeaving = (
  sections: ReadonlyArray<OpenTabsView.Section>,
  leaving: ReadonlyArray<Leaving>,
): ReadonlyArray<OpenTabsView.Section> => {
  if (leaving.length === 0) return sections;
  // The part a row goes back to: its own, else the end of its group's last part.
  const placeOf = (row: Leaving): Leaving | undefined => {
    const section = sections.find((s) => s.id === row.sectionId);
    if (section === undefined) return undefined;
    if (section.windows.some((part) => part.id === row.partId)) return row;
    const last = section.windows.at(-1);
    return last === undefined ? undefined : { ...row, partId: last.id, index: Infinity };
  };
  const byPart = new Map<string, Array<Leaving>>();
  for (const row of leaving) {
    const place = placeOf(row);
    if (place !== undefined) byPart.set(place.partId, [...(byPart.get(place.partId) ?? []), place]);
  }
  if (byPart.size === 0) return sections;
  return sections.map((section) => {
    if (!section.windows.some((part) => byPart.has(part.id))) return section;
    return {
      ...section,
      windows: section.windows.map((part) => {
        const rows = byPart.get(part.id);
        if (rows === undefined) return part;
        const tabs = [...part.tabs];
        for (const row of rows.toSorted((a, b) => a.index - b.index)) {
          if (!tabs.some((tab) => tab.key === row.tab.key)) {
            tabs.splice(Math.min(row.index, tabs.length), 0, row.tab);
          }
        }
        return { ...part, tabs };
      }),
    };
  });
};

/** The parts of the page that are moved one by one: the leaves, so no move counts twice. */
export const parts =
  "[data-slot=compact-row], [data-slot=compact-row-label], [data-slot=group-header]";

/** How long a part takes to slide to its place, in ms. */
export const slideMillis = 220;

/** Where each part under `root` stands now: its top on the screen. */
export const measure = (root: Element): Map<Element, number> => {
  const tops = new Map<Element, number>();
  for (const part of root.querySelectorAll(parts)) tops.set(part, part.getBoundingClientRect().top);
  return tops;
};

/**
 * After the rows changed: draws each part that moved since `before` where it was, then lets it
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
