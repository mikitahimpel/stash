import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "ext-platform",
    include: ["test/**/*.test.ts"],
  },
});
