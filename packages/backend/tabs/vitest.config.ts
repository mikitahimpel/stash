import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "backend-tabs",
    include: ["test/**/*.test.ts"],
  },
});
