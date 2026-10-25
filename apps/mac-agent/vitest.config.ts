import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "mac-agent",
    include: ["test/**/*.test.ts"],
  },
});
