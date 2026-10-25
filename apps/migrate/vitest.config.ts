import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "migrate",
    include: ["test/**/*.test.ts"],
  },
});
