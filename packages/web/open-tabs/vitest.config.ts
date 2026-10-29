import vue from "@vitejs/plugin-vue";
import * as VitestBase from "@stash/config-vitest/vitest-base";
import { defineProject, mergeConfig } from "vitest/config";

export default mergeConfig(
  VitestBase.base,
  defineProject({
    plugins: [vue()],
    test: {
      name: "web-open-tabs",
      include: ["test/**/*.test.ts"],
      environment: "happy-dom",
    },
  }),
);
