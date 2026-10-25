import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "mcp-tools-tabs",
    include: ["test/**/*.test.ts"],
  },
});
