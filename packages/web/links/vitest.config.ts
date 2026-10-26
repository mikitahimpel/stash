import vue from "@vitejs/plugin-vue";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [vue()],
  test: {
    name: "web-links",
    include: ["test/**/*.test.ts"],
    environment: "happy-dom",
    // The first test of each page file waits for the cold transform of the lazy route (the page
    // and the UI kit), which can exceed the 5 s default on a busy CI runner.
    testTimeout: 30_000,
  },
});
