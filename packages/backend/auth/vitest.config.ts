import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "backend-auth",
    include: ["test/**/*.test.ts"],
  },
});
