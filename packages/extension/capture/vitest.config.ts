import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "ext-capture",
    include: ["test/**/*.test.ts"],
  },
});
