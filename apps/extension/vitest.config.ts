import vue from "@vitejs/plugin-vue";
import * as VitestBase from "@stash/config-vitest/vitest-base";
import { defineProject, mergeConfig } from "vitest/config";

export default mergeConfig(
  VitestBase.base,
  defineProject({
    // For `test/popup-page.test.ts`, which mounts the popup page.
    plugins: [vue()],
    test: {
      name: "extension",
      include: ["test/**/*.test.ts"],
    },
  }),
);
