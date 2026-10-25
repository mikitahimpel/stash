import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Two-package fixture driven by the repo's real turbo.json: `app` consumes the
// just-in-time package `dep` (no build step), so only the `transit` node makes
// a change in `dep` reach `app`'s task hashes.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const turbo = join(repoRoot, "node_modules/.bin/turbo");

const root = mkdtempSync(join(tmpdir(), "stash-turbo-transit-"));
const write = (path: string, content: unknown): void =>
  writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));

cpSync(join(repoRoot, "turbo.json"), join(root, "turbo.json"));
cpSync(join(repoRoot, "package.json"), join(root, "package.json"));
write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
for (const [name, deps] of [
  ["dep", {}],
  ["app", { dep: "workspace:*" }],
] as const) {
  cpSync(
    join(repoRoot, "packages/config/tsconfig/base.json"),
    join(root, `packages/${name}/tsconfig.json`),
  );
  write(`packages/${name}/package.json`, {
    name,
    private: true,
    dependencies: deps,
    scripts: { typecheck: "true", test: "true" },
  });
  write(`packages/${name}/index.ts`, "export {};\n");
}

// Strip the outer turbo run's env so the nested run hashes the fixture alone.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("TURBO_")),
);

const hashes = (task: string): Record<string, string> => {
  const out = execFileSync(turbo, ["run", task, "--dry=json"], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const { tasks } = JSON.parse(out) as { tasks: ReadonlyArray<{ taskId: string; hash: string }> };
  return Object.fromEntries(tasks.map(({ taskId, hash }) => [taskId, hash]));
};

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("turbo transit node", () => {
  it.each(["typecheck", "test"])(
    "a dependency's source change invalidates dependent %s",
    (task) => {
      const before = hashes(task);
      write("packages/dep/index.ts", `export const changed = ${Date.now()};\n`);
      const after = hashes(task);
      expect(after[`app#${task}`]).not.toBe(before[`app#${task}`]);
    },
  );

  it("a dependent's change leaves its dependency's hash alone", () => {
    const before = hashes("typecheck");
    write("packages/app/index.ts", `export const changed = ${Date.now()};\n`);
    const after = hashes("typecheck");
    expect(after["dep#typecheck"]).toBe(before["dep#typecheck"]);
    expect(after["app#typecheck"]).not.toBe(before["app#typecheck"]);
  });
});
