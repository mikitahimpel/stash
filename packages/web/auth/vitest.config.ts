import vue from "@vitejs/plugin-vue";
import * as VitestBase from "@stash/config-vitest/vitest-base";
import { defineProject, mergeConfig } from "vitest/config";

export default mergeConfig(
  VitestBase.base,
  defineProject({
    plugins: [vue()],
    test: {
      name: "web-auth",
      include: ["test/**/*.test.ts"],
      environment: "happy-dom",
      // A synthetic api origin. The stub api ignores it.
      env: { VITE_API_BASE_URL: "https://api.example.com" },
    },
  }),
);
