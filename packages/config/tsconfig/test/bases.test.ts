import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type TsConfig = {
  readonly extends?: string;
  readonly compilerOptions: Record<string, unknown>;
};

const read = (name: string): TsConfig =>
  JSON.parse(readFileSync(new URL(`../${name}.json`, import.meta.url), "utf8")) as TsConfig;

describe("tsconfig bases", () => {
  it("base is strict with bundler resolution", () => {
    const { compilerOptions } = read("base");
    expect(compilerOptions).toMatchObject({
      strict: true,
      moduleResolution: "bundler",
      verbatimModuleSyntax: true,
      exactOptionalPropertyTypes: true,
    });
  });

  it.each(["workers", "web", "extension", "node"])("%s extends base", (name) => {
    expect(read(name).extends).toBe("./base.json");
  });

  it("workers has no DOM lib", () => {
    const lib = read("workers").compilerOptions["lib"] as ReadonlyArray<string>;
    expect(lib.some((entry) => entry.startsWith("DOM"))).toBe(false);
  });
});
