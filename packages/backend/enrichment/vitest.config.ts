import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "backend-enrichment",
    include: ["test/**/*.test.ts"],
  },
});
