import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "web-api-client",
    include: ["test/**/*.test.ts"],
    // A synthetic api origin, so tests can check that requests go to `VITE_API_BASE_URL`.
    env: { VITE_API_BASE_URL: "https://api.example.com" },
  },
});
