import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "api",
    include: ["test/**/*.test.ts"],
    // The smoke test boots `alchemy dev` (workerd + local D1 and Queue simulators).
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
