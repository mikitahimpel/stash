import * as VitestBase from "@stash/config-vitest/vitest-base";
import { defineProject, mergeConfig } from "vitest/config";

export default mergeConfig(
  VitestBase.base,
  defineProject({
    test: {
      name: "config-oxlint",
      include: ["test/**/*.test.ts"],
      // Each case spawns the real oxlint binary.
      testTimeout: 30_000,
    },
  }),
);
