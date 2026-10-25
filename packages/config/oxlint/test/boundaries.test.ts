import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type Diagnostic = {
  readonly code: string;
  readonly message: string;
  readonly filename: string;
};

type LintResult = {
  readonly status: number | null;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
};

const sharedConfig = fileURLToPath(new URL("../oxlintrc.json", import.meta.url));
const oxlintBin = fileURLToPath(new URL("../node_modules/.bin/oxlint", import.meta.url));

const fixtures: Array<string> = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Writes a synthetic monorepo into a temp dir whose root config extends the shared one,
// then runs oxlint there exactly like `pnpm lint` does in the real repo.
const lint = (files: Record<string, string>): LintResult => {
  const root = mkdtempSync(join(tmpdir(), "stash-oxlint-"));
  fixtures.push(root);
  writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify({ extends: [sharedConfig] }));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  const result = spawnSync(oxlintBin, ["--format", "json", "."], { cwd: root, encoding: "utf8" });
  const { diagnostics } = JSON.parse(result.stdout) as { diagnostics: Array<Diagnostic> };
  return { status: result.status, diagnostics };
};

const codes = ({ diagnostics }: LintResult) => diagnostics.map(({ code }) => code);

describe("context boundaries", () => {
  it("rejects a cross-context import from web into backend", () => {
    const result = lint({
      "packages/web/links/src/links-page.ts":
        'import * as Links from "@stash/backend-x";\nexport const page = Links;\n',
    });
    expect(result.status).not.toBe(0);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "eslint(no-restricted-imports)",
        filename: "packages/web/links/src/links-page.ts",
        message: expect.stringContaining("'@stash/backend-x' import is restricted"),
      }),
    );
  });

  it("rejects cross-context subpath imports", () => {
    const result = lint({
      "apps/web/src/main.ts":
        'import * as Repo from "@stash/backend-links/links-repo";\nexport const r = Repo;\n',
    });
    expect(result.status).not.toBe(0);
    expect(codes(result)).toEqual(["eslint(no-restricted-imports)"]);
  });

  it("allows contracts, own-context and config imports from web", () => {
    const result = lint({
      "packages/web/links/src/links-page.ts": [
        'import * as Link from "@stash/contracts-domain/link";',
        'import * as Ui from "@stash/web-ui/button";',
        'import * as Local from "./links-atoms.ts";',
        "export const page = [Link, Ui, Local];",
        "",
      ].join("\n"),
      "packages/web/links/src/links-atoms.ts": "export const atoms = 1;\n",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.status).toBe(0);
  });

  it.each([
    ["packages/backend/links/src/a.ts", "@stash/web-ui", "@stash/backend-auth"],
    ["apps/api/src/a.ts", "@stash/mcp-tools-links", "@stash/backend-links"],
    ["packages/mcp/tools-links/src/a.ts", "@stash/backend-links", "@stash/mcp-platform"],
    ["packages/extension/capture/src/a.ts", "@stash/web-ui", "@stash/ext-platform"],
    ["apps/mac-agent/src/a.ts", "@stash/backend-links", "@stash/contracts-api"],
    ["apps/migrate/src/a.ts", "@stash/ext-capture", "@stash/contracts-domain"],
  ])("%s rejects %s and allows %s", (path, banned, allowed) => {
    const bad = lint({ [path]: `import * as X from "${banned}";\nexport const x = X;\n` });
    expect(bad.status).not.toBe(0);
    expect(codes(bad)).toEqual(["eslint(no-restricted-imports)"]);

    const good = lint({ [path]: `import * as X from "${allowed}";\nexport const x = X;\n` });
    expect(good.diagnostics).toEqual([]);
    expect(good.status).toBe(0);
  });

  it("restricts contracts to effect and other contracts", () => {
    const bad = lint({
      "packages/contracts/domain/src/link.ts": [
        'import * as Z from "zod";',
        'import * as Fs from "node:fs";',
        'import * as Ui from "@stash/web-ui";',
        "export const link = [Z, Fs, Ui];",
        "",
      ].join("\n"),
    });
    expect(bad.status).not.toBe(0);
    expect(codes(bad)).toEqual(Array(3).fill("eslint(no-restricted-imports)"));

    const good = lint({
      "packages/contracts/api/src/links-api.ts": [
        'import { Schema } from "effect";',
        'import * as HttpApi from "effect/unstable/httpapi/HttpApi";',
        'import * as Link from "@stash/contracts-domain/link";',
        "export const api = [Schema, HttpApi, Link];",
        "",
      ].join("\n"),
      "packages/contracts/api/test/links-api.test.ts":
        'import { it } from "@effect/vitest";\nexport const t = it;\n',
    });
    expect(good.diagnostics).toEqual([]);
    expect(good.status).toBe(0);
  });

  it("allows vitest/config in a contracts vitest.config.ts", () => {
    const result = lint({
      "packages/contracts/domain/vitest.config.ts":
        'import { defineProject } from "vitest/config";\nexport default defineProject({});\n',
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.status).toBe(0);
  });
});

describe("relative imports across packages", () => {
  const packages = {
    "packages/web/links/package.json": "{}",
    "packages/web/ui/package.json": "{}",
    "packages/backend/links/package.json": "{}",
    "packages/backend/links/src/links-repo.ts": "export const repo = 1;\n",
    "packages/web/ui/src/button.ts": "export const button = 1;\n",
  };

  it.each([
    ["into another context", "../../../backend/links/src/links-repo.ts"],
    ["into another package of the same context", "../../ui/src/button.ts"],
    ["to another package's root", "../../ui"],
  ])("rejects a relative import %s", (_, specifier) => {
    const result = lint({
      ...packages,
      "packages/web/links/src/links-page.ts": `import * as X from "${specifier}";\nexport const x = X;\n`,
    });
    expect(result.status).not.toBe(0);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "stash(no-relative-packages)",
        filename: "packages/web/links/src/links-page.ts",
      }),
    ]);
  });

  it("rejects re-exports and dynamic imports that cross a package", () => {
    const result = lint({
      ...packages,
      "packages/web/links/src/links-page.ts": [
        'export * from "../../ui/src/button.ts";',
        'export const lazy = () => import("../../ui/src/button.ts");',
        "",
      ].join("\n"),
    });
    expect(result.status).not.toBe(0);
    expect(codes(result)).toEqual(Array(2).fill("stash(no-relative-packages)"));
  });

  it("allows relative imports within the same package", () => {
    const result = lint({
      ...packages,
      "packages/web/links/src/list/links-list.ts": [
        'import * as Atoms from "../links-atoms.ts";',
        'import * as Item from "./links-item.ts";',
        'import * as Manifest from "../../package.json";',
        "export const list = [Atoms, Item, Manifest];",
        "",
      ].join("\n"),
      "packages/web/links/src/list/links-item.ts": "export const item = 1;\n",
      "packages/web/links/src/links-atoms.ts": "export const atoms = 1;\n",
      "packages/web/links/test/links-list.test.ts":
        'import * as List from "../src/list/links-list.ts";\nexport const t = List;\n',
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.status).toBe(0);
  });
});

describe("runtime globals", () => {
  it("rejects fetch outside a platform package", () => {
    const result = lint({
      "packages/web/links/src/save-link.ts": 'export const save = () => fetch("/api/links");\n',
    });
    expect(result.status).not.toBe(0);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "eslint(no-restricted-globals)",
        message: expect.stringContaining("Unexpected use of 'fetch'"),
      }),
    );
  });

  it.each([
    "window",
    "document",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "navigator",
    "chrome",
    "browser",
  ])("rejects %s outside a platform package", (name) => {
    const result = lint({
      "packages/extension/capture/src/capture.ts": `export const g = ${name};\n`,
    });
    expect(result.status).not.toBe(0);
    expect(codes(result)).toEqual(["eslint(no-restricted-globals)"]);
  });

  it("allows runtime globals inside platform packages", () => {
    const result = lint({
      "packages/web/platform/src/network.ts": 'export const get = () => fetch("/api");\n',
      "packages/extension/platform/src/tabs.ts": "export const tabs = () => browser.tabs;\n",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.status).toBe(0);
  });

  it("exempts .vue templates but not their script blocks", () => {
    const template = lint({
      "packages/web/links/src/link-card.vue":
        '<script setup lang="ts">\nconst title = "x";\n</script>\n<template><a :href="title">{{ window }}</a></template>\n',
    });
    expect(template.diagnostics).toEqual([]);

    const script = lint({
      "packages/web/links/src/link-card.vue":
        '<script setup lang="ts">\nconst title = document.title;\n</script>\n<template><p>{{ title }}</p></template>\n',
    });
    expect(codes(script)).toEqual(["eslint(no-restricted-globals)"]);
  });
});

describe("conventions", () => {
  it("rejects non-kebab-case file names", () => {
    const result = lint({ "packages/web/links/src/LinkCard.ts": "export const card = 1;\n" });
    expect(result.status).not.toBe(0);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unicorn(filename-case)",
        filename: "packages/web/links/src/LinkCard.ts",
      }),
    );
  });

  it("accepts kebab-case file names", () => {
    const result = lint({ "packages/web/links/src/link-card.ts": "export const card = 1;\n" });
    expect(result.diagnostics).toEqual([]);
    expect(result.status).toBe(0);
  });

  it("rejects import cycles", () => {
    const result = lint({
      "packages/web/links/src/links-a.ts":
        'import { b } from "./links-b.ts";\nexport const a = () => b;\n',
      "packages/web/links/src/links-b.ts":
        'import { a } from "./links-a.ts";\nexport const b = () => a;\n',
    });
    expect(result.status).not.toBe(0);
    expect(codes(result)).toContain("import(no-cycle)");
  });

  it("lints .vue templates through oxlint-plugin-vue-sfc", () => {
    const result = lint({
      "packages/web/links/src/links-list.vue":
        '<script setup lang="ts">\nconst items = [1, 2];\n</script>\n<template><ul><li v-for="i in items">{{ i }}</li></ul></template>\n',
    });
    expect(result.status).not.toBe(0);
    expect(codes(result)).toEqual(["vue-sfc(require-v-for-key)"]);
  });
});
