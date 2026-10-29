import * as VitestBase from "@stash/config-vitest/vitest-base";
import { defineProject, mergeConfig } from "vitest/config";

export default mergeConfig(
  VitestBase.base,
  defineProject({
    test: {
      name: "api",
      include: ["test/**/*.test.ts"],
      // The smoke test boots `alchemy dev` (workerd + local D1 and Queue simulators).
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  }),
);
