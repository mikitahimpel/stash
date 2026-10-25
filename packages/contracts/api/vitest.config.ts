import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "contracts-api",
    include: ["test/**/*.test.ts"],
  },
});
