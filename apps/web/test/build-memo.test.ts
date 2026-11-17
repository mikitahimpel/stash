// @vitest-environment node
import * as Path from "node:path";
import { glob } from "tinyglobby";
import { describe, expect, it } from "vitest";
import * as BuildMemo from "../scripts/build-memo.ts";

const appDir = Path.resolve(import.meta.dirname, "..");

/** Directories that hold dependencies or build output, never inputs. */
const generated = ["node_modules", ".output", ".wxt", "dist", ".turbo", ".alchemy", ".wrangler"];

const outside = (patterns: ReadonlyArray<string>) =>
  patterns.filter((pattern) => pattern.startsWith("../"));

/** The files Alchemy hashes for the patterns outside `apps/web`, globbed the way it globs them. */
const resolve = (patterns: ReadonlyArray<string>) =>
  glob(outside(patterns), { cwd: appDir, onlyFiles: true, expandDirectories: false, dot: true });

describe.each([
  { name: "deploy", dev: false },
  { name: "alchemy dev", dev: true },
])("build memo for $name", ({ dev }) => {
  const include = BuildMemo.include(dev);

  it("covers the app and the web packages", () => {
    expect(include).toContain("**/*");
    expect(include).toContain("../../packages/web/*/src/**");
  });

  it("names a subdirectory or root files of each tree outside the app, never a whole tree", () => {
    for (const pattern of outside(include)) {
      // `../extension/**` and `../../packages/web/*/**` would walk `node_modules`.
      expect(pattern).not.toMatch(/^(\.\.\/)+(packages\/[^/]+\/)?[^/]+\/\*\*/);
      expect(pattern).not.toMatch(/^(\.\.\/)+\*\*/);
      for (const segment of pattern.split("/")) expect(generated).not.toContain(segment);
    }
  });

  it("resolves to source files only, and to few of them", async () => {
    const files = await resolve(include);
    const stray = files.filter((file) => file.split("/").some((part) => generated.includes(part)));
    expect(stray).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
    expect(files.length).toBeLessThan(2000);
  });
});

describe("build memo for deploy", () => {
  it("covers what the downloads are built from", async () => {
    const files = await resolve(BuildMemo.include(false));
    for (const input of [
      "../extension/entrypoints/background.ts",
      "../extension/entrypoints/options/options-page.vue",
      "../extension/scripts/package-xpi.ts",
      "../extension/wxt.config.ts",
      "../extension/package.json",
      "../mac-agent/src/main.ts",
      "../mac-agent/bundle.config.ts",
      "../mac-agent/install-standalone.sh",
      "../mac-agent/package.json",
    ]) {
      expect(files).toContain(input);
    }
    expect(files.some((file) => file.startsWith("../../packages/extension/"))).toBe(true);
    expect(files.some((file) => file.startsWith("../../packages/contracts/"))).toBe(true);
  });
});

describe("build memo for alchemy dev", () => {
  it("leaves out the extension and the Mac agent", () => {
    const include = BuildMemo.include(true);
    expect(include.filter((pattern) => /extension|mac-agent|contracts/.test(pattern))).toEqual([]);
  });
});
