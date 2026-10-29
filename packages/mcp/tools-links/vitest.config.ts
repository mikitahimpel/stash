import * as VitestBase from "@stash/config-vitest/vitest-base";
import { defineProject, mergeConfig } from "vitest/config";

export default mergeConfig(
  VitestBase.base,
  defineProject({
    test: {
      name: "mcp-tools-links",
      include: ["test/**/*.test.ts"],
    },
  }),
);
