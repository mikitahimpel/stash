import * as VitestBase from "./vitest-base.ts";
import { defineProject, mergeConfig } from "vitest/config";

export default mergeConfig(
  VitestBase.base,
  defineProject({
    test: {
      name: "config-vitest",
      include: ["test/**/*.test.ts"],
      // Resolves the config of every package in the repo.
      testTimeout: 60_000,
    },
  }),
);
