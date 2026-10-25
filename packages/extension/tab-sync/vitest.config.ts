import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "ext-tab-sync",
    include: ["test/**/*.test.ts"],
  },
});
