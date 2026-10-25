import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "ext-device-commands",
    include: ["test/**/*.test.ts"],
  },
});
