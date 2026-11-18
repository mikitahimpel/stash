import { describe, expect, it } from "vitest";
import * as Routes from "../src/routes.ts";

describe("search routes", () => {
  it("reads the query of a link to the page", () => {
    expect(Routes.queryOf({ query: { q: "effect layers" } })).toBe("effect layers");
    expect(Routes.queryOf({ query: {} })).toBeUndefined();
    expect(Routes.queryOf({ query: { q: "  " } })).toBeUndefined();
    expect(Routes.queryOf({ query: { q: ["a", "b"] } })).toBeUndefined();
  });
});
