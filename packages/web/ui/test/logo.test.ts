import { readFileSync } from "node:fs";
import * as Path from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(Path.resolve(import.meta.dirname, "../src/logo", name), "utf8");
const marks = { full: read("stash-mark.svg"), small: read("stash-mark-sm.svg") };

const ids = (svg: string) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const refs = (svg: string) => [...svg.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);

describe("the logo SVGs", () => {
  it.each(Object.entries(marks))("%s: stands alone, with every reference inside it", (_, svg) => {
    expect(svg).toContain('viewBox="0 0 256 256"');
    // No <use>, image, font or stylesheet from elsewhere.
    expect(svg).not.toMatch(/href=|@import|<image|<script/);
    expect(svg.match(/https?:\/\/[^"\s]+/g)).toEqual(["http://www.w3.org/2000/svg"]);
    expect(refs(svg).length).toBeGreaterThan(0);
    for (const ref of refs(svg)) expect(ids(svg), ref).toContain(ref);
    expect(new Set(ids(svg)).size).toBe(ids(svg).length);
  });

  it("keeps the ids of the two apart, so both can be inlined in one page", () => {
    const small = new Set(ids(marks.small));
    expect(ids(marks.full).filter((id) => small.has(id))).toEqual([]);
    for (const id of ids(marks.full)) expect(id).toMatch(/^stash-well-/);
    for (const id of small) expect(id).toMatch(/^stash-well-sm-/);
  });
});
