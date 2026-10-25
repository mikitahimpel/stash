import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "contracts-domain",
    include: ["test/**/*.test.ts"],
  },
});
