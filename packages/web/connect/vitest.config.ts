import vue from "@vitejs/plugin-vue";
import * as VitestBase from "@stash/config-vitest/vitest-base";
import { defineProject, mergeConfig } from "vitest/config";

export default mergeConfig(
  VitestBase.base,
  defineProject({
    plugins: [vue()],
    test: {
      name: "web-connect",
      include: ["test/**/*.test.ts"],
      environment: "happy-dom",
      // The guides prefill values from the page's origin.
      environmentOptions: { happyDOM: { url: "https://stash.example.com/connect" } },
    },
  }),
);
