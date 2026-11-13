import { describe, expect, it } from "vitest";
import { audit, type Control, type Snapshot } from "../scripts/layout-audit-rules.ts";

const content = { left: 264, right: 1176 };
const page = (patch: Partial<Snapshot>): Snapshot => ({
  content,
  controls: [],
  blocks: [],
  gaps: [],
  groups: [],
  mono: [],
  ...patch,
});
const control = (patch: Partial<Control>): Control => ({
  label: "button",
  block: 0,
  top: 100,
  height: 36,
  hit: 44,
  row: false,
  ...patch,
});
const rules = (snapshot: Snapshot, phone = false) =>
  audit(snapshot, { phone }).map((violation) => violation.rule);

describe("layout audit rules", () => {
  it("passes a page built from the tokens", () => {
    const snapshot = page({
      controls: [control({}), control({ label: "input", top: 100 })],
      blocks: [{ label: "row", left: 264, right: 1176, rightIsBox: true, centered: false }],
      gaps: [{ label: "header → list", px: 48 }],
      groups: [{ kind: "card", label: "card", edges: [{ label: "title", left: 280 }] }],
    });
    expect(audit(snapshot, { phone: true })).toEqual([]);
  });

  it("flags a control height off 32 / 36 / 44", () => {
    expect(rules(page({ controls: [control({ height: 40 })] }))).toEqual(["height"]);
    expect(rules(page({ controls: [control({ height: 32.4 })] }))).toEqual([]);
  });

  it("needs a 44px hit area on phones only", () => {
    const small = page({ controls: [control({ height: 32, hit: 32 })] });
    expect(rules(small)).toEqual([]);
    expect(rules(small, true)).toEqual(["hit area"]);
  });

  it("flags controls on one row with different heights or centres", () => {
    const mixed = page({
      controls: [control({ height: 36 }), control({ height: 32, top: 102, label: "chip" })],
    });
    expect(rules(mixed)).toEqual(["row"]);
    // Stacked controls, or controls in different blocks, aren't on one row.
    const stacked = page({ controls: [control({}), control({ height: 32, top: 140 })] });
    expect(rules(stacked)).toEqual([]);
    const apart = page({ controls: [control({}), control({ height: 32, block: 1 })] });
    expect(rules(apart)).toEqual([]);
    // A row's title link is not compared with the actions beside it.
    const titled = page({ controls: [control({ row: true }), control({ height: 32 })] });
    expect(rules(titled)).toEqual([]);
  });

  it("flags a block that starts off the content edge, like an x+12 row", () => {
    const inset = page({
      blocks: [{ label: "row", left: 276, right: 1000, rightIsBox: false, centered: false }],
    });
    expect(rules(inset)).toEqual(["left edge"]);
    const centred = page({
      blocks: [{ label: "empty", left: 600, right: 800, rightIsBox: false, centered: true }],
    });
    expect(rules(centred)).toEqual([]);
  });

  it("flags a trailing control inset from the right edge, and anything past it", () => {
    const block = { label: "row", left: 264, centered: false } as const;
    expect(rules(page({ blocks: [{ ...block, right: 1164, rightIsBox: true }] }))).toEqual([
      "right edge",
    ]);
    // Text that wraps short of the edge is fine; a box far from it is a left-aligned control.
    expect(rules(page({ blocks: [{ ...block, right: 1164, rightIsBox: false }] }))).toEqual([]);
    expect(rules(page({ blocks: [{ ...block, right: 600, rightIsBox: true }] }))).toEqual([]);
    expect(rules(page({ blocks: [{ ...block, right: 1243, rightIsBox: false }] }))).toEqual([
      "right edge",
    ]);
  });

  it("flags card rows and row lines that don't share one edge", () => {
    const card = page({
      groups: [
        {
          kind: "card",
          label: "card",
          edges: [
            { label: "title", left: 280 },
            { label: "row", left: 292 },
          ],
        },
        {
          kind: "row",
          label: "row",
          edges: [
            { label: "title", left: 264 },
            { label: "summary", left: 276 },
          ],
        },
      ],
    });
    expect(rules(card)).toEqual(["card", "row lines"]);
  });

  it("flags gaps off the spacing scale", () => {
    const gaps = page({
      gaps: [
        { label: "a → b", px: 20 },
        { label: "rows", px: 0 },
        { label: "c → d", px: 24 },
      ],
    });
    expect(rules(gaps)).toEqual(["gap"]);
  });

  it("flags mono text outside the allowlist", () => {
    expect(rules(page({ mono: ['span "example.com"'] }))).toEqual(["mono"]);
  });
});
