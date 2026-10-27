// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Reads the hex tokens of one theme block (`:root` is light, `.dark` is dark) from styles.css.
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");

const tokens = (selector: ":root" | ".dark"): ReadonlyMap<string, string> => {
  const block = new RegExp(`^${selector.replace(".", "\\.")} \\{([^}]*)\\}`, "m").exec(css)?.[1];
  if (block === undefined) throw new Error(`no ${selector} block in styles.css`);
  return new Map(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, hex]) => [
      name ?? "",
      hex ?? "",
    ]),
  );
};

// WCAG 2.x relative luminance and contrast ratio.
const luminance = (hex: string): number => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
};

// Every text color, on every background it is drawn on.
const textPairs: ReadonlyArray<readonly [text: string, backgrounds: ReadonlyArray<string>]> = [
  [
    "foreground",
    ["background", "surface", "sunken", "pressed", "row-selected-from", "row-selected-to"],
  ],
  [
    "muted-foreground",
    ["background", "surface", "sunken", "row-selected-from", "row-selected-to", "raised-to"],
  ],
  ["raised-foreground", ["raised-from", "raised-to", "raised-hover-from", "raised-active"]],
  [
    "key-primary-foreground",
    ["key-primary-from", "key-primary-to", "key-primary-hover-to", "key-primary-active"],
  ],
  ["foreground", ["key-from", "key-to"]],
  ["destructive", ["background", "surface"]],
  ["destructive-foreground", ["destructive"]],
];

// The accent marks stale / unread / match with ticks, dots and bars: non-text, so 3:1.
const markPairs: ReadonlyArray<readonly [mark: string, backgrounds: ReadonlyArray<string>]> = [
  ["signal", ["background", "surface", "row-selected-from"]],
];

describe.each([
  ["light", ":root"],
  ["dark", ".dark"],
] as const)("%s theme contrast", (_, selector) => {
  const theme = tokens(selector);
  const value = (name: string) => {
    const hex = theme.get(name);
    if (hex === undefined) throw new Error(`${selector} has no hex token --${name}`);
    return hex;
  };

  it.each(textPairs.flatMap(([text, backgrounds]) => backgrounds.map((bg) => [text, bg] as const)))(
    "text --%s on --%s is at least 4.5:1",
    (text, bg) => {
      expect(contrast(value(text), value(bg))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(markPairs.flatMap(([mark, backgrounds]) => backgrounds.map((bg) => [mark, bg] as const)))(
    "mark --%s on --%s is at least 3:1",
    (mark, bg) => {
      expect(contrast(value(mark), value(bg))).toBeGreaterThanOrEqual(3);
    },
  );
});

describe("contrast", () => {
  it("matches the WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
