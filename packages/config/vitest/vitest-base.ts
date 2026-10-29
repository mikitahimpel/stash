import { defineProject } from "vitest/config";

// Shared by every package's `vitest.config.ts` through `mergeConfig`. Caps the test workers of one
// `vitest run`. See "Resource limits" in the root CLAUDE.md. Vitest 5 has no `minWorkers` option.
export const base = defineProject({
  test: {
    maxWorkers: 2,
  },
});
