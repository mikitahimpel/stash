import * as Path from "node:path";
import * as VitestBase from "@stash/config-vitest/vitest-base";
import { defineProject, mergeConfig } from "vitest/config";

export default mergeConfig(
  VitestBase.base,
  defineProject({
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
  }),
);
