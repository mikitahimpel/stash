import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "config-oxlint",
    include: ["test/**/*.test.ts"],
    // Each case spawns the real oxlint binary.
    testTimeout: 30_000,
  },
});
