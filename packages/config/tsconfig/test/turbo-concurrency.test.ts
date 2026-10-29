import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Eight independent packages driven by the repo's real turbo.json. Each `test` task marks itself
// as running, records how many tasks run at that moment, and sleeps, so the largest record is the
// concurrency turbo actually used. `turbo run --dry=json` does not report it.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const turbo = join(repoRoot, "node_modules/.bin/turbo");
const packages = 8;

const root = mkdtempSync(join(tmpdir(), "stash-turbo-concurrency-"));
const write = (path: string, content: unknown): void =>
  writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));

cpSync(join(repoRoot, "turbo.json"), join(root, "turbo.json"));
cpSync(join(repoRoot, "package.json"), join(root, "package.json"));
write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
mkdirSync(join(root, "running"));
mkdirSync(join(root, "seen"));
write(
  "probe.mjs",
  [
    'import { readdirSync, rmSync, writeFileSync } from "node:fs";',
    "const self = `../../running/${process.pid}`;",
    'writeFileSync(self, "");',
    'writeFileSync(`../../seen/${process.pid}-${readdirSync("../../running").length}`, "");',
    "await new Promise((resolve) => setTimeout(resolve, 1000));",
    "rmSync(self);",
  ].join("\n"),
);
for (let index = 0; index < packages; index++) {
  mkdirSync(join(root, `packages/p${index}`), { recursive: true });
  write(`packages/p${index}/package.json`, {
    name: `p${index}`,
    private: true,
    scripts: { test: "node ../../probe.mjs" },
  });
}

// Strip the outer turbo run's env so the nested run reads the fixture's config alone.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("TURBO_")),
);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("turbo concurrency", () => {
  it("runs at most 4 tasks at once", () => {
    execFileSync(turbo, ["run", "test", "--force", "--output-logs=none"], {
      cwd: root,
      env,
      stdio: "ignore",
    });
    const seen = readdirSync(join(root, "seen")).map((name) => Number(name.split("-")[1]));
    expect(seen).toHaveLength(packages);
    expect(Math.max(...seen)).toBe(4);
  });
});
