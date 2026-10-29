import { globSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vitest/node";
import { describe, expect, it } from "vitest";

// Resolves each package's real `vitest.config.ts` the way `vitest run` in that package does, and
// checks that the shared cap from `vitest-base.ts` survives. Covers every context.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const configs = globSync(["apps/*/vitest.config.ts", "packages/*/*/vitest.config.ts"], {
  cwd: repoRoot,
}).sort();

// The env var overrides any config, so the outer run's value must not leak into the check.
delete process.env["VITEST_MAX_WORKERS"];

describe("vitest maxWorkers", () => {
  it("finds a package in every context", () => {
    const contexts = new Set(configs.map((config) => config.split("/").slice(0, -2).join("/")));
    expect([...contexts]).toEqual(
      expect.arrayContaining([
        "apps",
        "packages/backend",
        "packages/config",
        "packages/contracts",
        "packages/extension",
        "packages/mcp",
        "packages/web",
      ]),
    );
  });

  it.each(configs)("%s resolves maxWorkers to 2", async (config) => {
    const root = join(repoRoot, dirname(config));
    const resolved = await resolveConfig({ root, config: join(repoRoot, config) });
    const maxWorkers = resolved.test?.maxWorkers;
    console.log(`${dirname(config)}: maxWorkers=${maxWorkers}`);
    expect(maxWorkers).toBe(2);
  });
});
