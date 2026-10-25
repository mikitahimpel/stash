import vue from "@vitejs/plugin-vue";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [vue()],
  // Tests declare small harness components with inline templates, which needs the runtime compiler.
  resolve: { alias: { vue: "vue/dist/vue.esm-bundler.js" } },
  test: {
    name: "web-ui",
    include: ["test/**/*.test.ts"],
    environment: "happy-dom",
  },
});
