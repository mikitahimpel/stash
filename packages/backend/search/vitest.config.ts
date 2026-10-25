import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "backend-search",
    include: ["test/**/*.test.ts"],
  },
});
