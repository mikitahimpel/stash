import vue from "@vitejs/plugin-vue";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [vue()],
  test: {
    name: "web-auth",
    include: ["test/**/*.test.ts"],
    environment: "happy-dom",
    // A synthetic api origin, so tests can check where the login button points.
    env: { VITE_API_BASE_URL: "https://api.example.com" },
  },
});
