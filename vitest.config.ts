import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Same cap as @stash/config-vitest, for a run of all projects from the root.
    maxWorkers: 2,
    projects: ["apps/*/vitest.config.ts", "packages/*/*/vitest.config.ts"],
  },
});
