import * as Path from "node:path";
import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    // `@cloudflare/workers-oauth-provider` imports `WorkerEntrypoint` from the workerd runtime.
    alias: {
      "cloudflare:workers": Path.resolve(import.meta.dirname, "test/cloudflare-workers-stub.ts"),
    },
  },
  test: {
    name: "mcp",
    include: ["test/**/*.test.ts"],
    // Bundle it, so the alias above applies to its imports too.
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
  },
});
