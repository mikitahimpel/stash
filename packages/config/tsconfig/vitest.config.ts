import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "config-tsconfig",
    include: ["test/**/*.test.ts"],
  },
});
