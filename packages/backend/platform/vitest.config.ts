import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "backend-platform",
    include: ["test/**/*.test.ts"],
  },
});
