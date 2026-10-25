import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "mcp-tools-digest",
    include: ["test/**/*.test.ts"],
  },
});
