// The rules of the layout audit (`scripts/layout-audit.ts`), as plain functions over what the
// in-page probe (`layout-audit-probe.ts`) measured, so they are unit tested without a browser.
// See docs/design.md, "Tokens" and "Layout audit".

/** What the probe measured on one page, in CSS pixels. */
export interface Snapshot {
  /** The content edges: `<main>`'s content box. */
  readonly content: { readonly left: number; readonly right: number };
  readonly controls: ReadonlyArray<Control>;
  readonly blocks: ReadonlyArray<Block>;
  /** Vertical gaps between stacked page-level blocks. */
  readonly gaps: ReadonlyArray<{ readonly label: string; readonly px: number }>;
  /**
   * Things that must start on one x: a card's title and its rows (`card`), and the lines of one
   * list row (`row`: title, wrapped meta, summary, tags, action bar).
   */
  readonly groups: ReadonlyArray<{
    readonly kind: "card" | "row";
    readonly label: string;
    readonly edges: ReadonlyArray<{ readonly label: string; readonly left: number }>;
  }>;
  /** Elements whose text renders in mono outside the allowlist (keys, device code, charts). */
  readonly mono: ReadonlyArray<string>;
}

export interface Control {
  readonly label: string;
  /** The page-level block the control is in, to find controls on one row. */
  readonly block: number;
  readonly top: number;
  readonly height: number;
  /** The height of its hit area: the box or its `::after`, whichever is taller. */
  readonly hit: number;
  /** A row's title link (`a[data-row]`), which is not compared with the controls beside it. */
  readonly row: boolean;
}

export interface Block {
  readonly label: string;
  /** Where its ink starts: a surface's border box, otherwise its first text or control. */
  readonly left: number | null;
  readonly right: number | null;
  /** The rightmost ink is a control or surface, so it should end on the content edge. */
  readonly rightIsBox: boolean;
  /** Centred blocks (empty and error states) are exempt from the edge rules. */
  readonly centered: boolean;
}

export interface Violation {
  readonly rule:
    | "height"
    | "hit area"
    | "row"
    | "left edge"
    | "right edge"
    | "card"
    | "row lines"
    | "gap"
    | "mono";
  readonly element: string;
  readonly detail: string;
}

export const controlHeights: ReadonlyArray<number> = [32, 36, 44];
export const minHitArea = 44;
/** 4 · 8 · 12 · 16 · 24 · 32 · 48, and 0 for blocks that touch (rows in a list). */
export const spacingScale: ReadonlyArray<number> = [0, 4, 8, 12, 16, 24, 32, 48];
/** Rounding: a box may sit half a pixel off. */
export const tolerance = 0.5;
/** A box this close to the content edge, but not on it, is a misaligned inset. */
export const nearEdge = 24;

const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
const px = (value: number) => `${Math.round(value * 10) / 10}px`;

const heights = (snapshot: Snapshot): Array<Violation> =>
  snapshot.controls
    .filter((control) => !controlHeights.some((height) => near(control.height, height)))
    .map((control) => ({
      rule: "height",
      element: control.label,
      detail: `${px(control.height)}, not one of ${controlHeights.join(" / ")}`,
    }));

const hitAreas = (snapshot: Snapshot): Array<Violation> =>
  snapshot.controls
    .filter((control) => control.hit < minHitArea - tolerance)
    .map((control) => ({
      rule: "hit area",
      element: control.label,
      detail: `${px(control.hit)} tall, phones need ${minHitArea}px`,
    }));

// Two controls are on one row when they share a block and overlap vertically by more than half
// of the shorter one.
const rows = (snapshot: Snapshot): Array<Violation> => {
  const controls = snapshot.controls.filter((control) => !control.row);
  const found: Array<Violation> = [];
  controls.forEach((a, i) => {
    for (const b of controls.slice(i + 1)) {
      if (a.block !== b.block) continue;
      const overlap = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
      if (overlap <= Math.min(a.height, b.height) / 2) continue;
      const centre = (c: Control) => c.top + c.height / 2;
      if (!near(a.height, b.height) || !near(centre(a), centre(b))) {
        found.push({
          rule: "row",
          element: `${a.label} | ${b.label}`,
          detail: `heights ${px(a.height)} / ${px(b.height)}, centres ${px(centre(a))} / ${px(centre(b))}`,
        });
      }
    }
  });
  return found;
};

const edges = (snapshot: Snapshot): Array<Violation> =>
  snapshot.blocks
    .filter((block) => !block.centered)
    .flatMap((block): Array<Violation> => {
      const found: Array<Violation> = [];
      if (block.left !== null && !near(block.left, snapshot.content.left)) {
        found.push({
          rule: "left edge",
          element: block.label,
          detail: `starts at x+${px(block.left - snapshot.content.left)} from the content edge`,
        });
      }
      if (block.right !== null) {
        const inset = snapshot.content.right - block.right;
        if (inset < -tolerance || (block.rightIsBox && inset > tolerance && inset <= nearEdge)) {
          found.push({
            rule: "right edge",
            element: block.label,
            detail: `ends ${px(inset)} before the content edge`,
          });
        }
      }
      return found;
    });

const groups = (snapshot: Snapshot): Array<Violation> =>
  snapshot.groups.flatMap((group) => {
    const first = group.edges[0];
    if (first === undefined) return [];
    return group.edges
      .filter((edge) => !near(edge.left, first.left))
      .map((edge) => ({
        rule: group.kind === "card" ? ("card" as const) : ("row lines" as const),
        element: `${group.label} › ${edge.label}`,
        detail: `starts at x+${px(edge.left - first.left)} from ${first.label}`,
      }));
  });

const gaps = (snapshot: Snapshot): Array<Violation> =>
  snapshot.gaps
    .filter((gap) => !spacingScale.some((step) => near(gap.px, step)))
    .map((gap) => ({
      rule: "gap",
      element: gap.label,
      detail: `${px(gap.px)}, not on the scale ${spacingScale.slice(1).join(" · ")}`,
    }));

const mono = (snapshot: Snapshot): Array<Violation> =>
  snapshot.mono.map((label) => ({
    rule: "mono",
    element: label,
    detail: "mono outside keys, the device code and chart labels",
  }));

/** Every rule broken on the page. Phones also need the 44px hit area. */
export const audit = (
  snapshot: Snapshot,
  options: { readonly phone: boolean },
): Array<Violation> => [
  ...heights(snapshot),
  ...(options.phone ? hitAreas(snapshot) : []),
  ...rows(snapshot),
  ...edges(snapshot),
  ...groups(snapshot),
  ...gaps(snapshot),
  ...mono(snapshot),
];
