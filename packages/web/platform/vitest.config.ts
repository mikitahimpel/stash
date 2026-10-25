import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "web-platform",
    include: ["test/**/*.test.ts"],
  },
});
