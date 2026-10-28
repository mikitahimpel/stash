import * as ApiClient from "@stash/mcp-platform/api-client";
import { env } from "cloudflare:workers";
import { Layer, Scheduler } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import * as GitHub from "./github-identity.ts";
import * as McpServer from "./mcp-server.ts";
import * as OAuthProvider from "./oauth-provider.ts";
import type { WorkerEnv } from "./worker-env.ts";

const workerEnv = env as unknown as WorkerEnv;

// Built once per isolate at module scope, as Workers require: fibers started inside `fetch` would
// capture that request's context. Global scope allows no timers, so fibers run on a sync scheduler.
const syncScheduler = Layer.succeed(Scheduler.Scheduler)(new Scheduler.MixedScheduler("sync"));
const mcp = HttpRouter.toWebHandler(
  McpServer.layer(ApiClient.layer(workerEnv)).pipe(Layer.provideMerge(syncScheduler)),
);

const github = GitHub.layer({ clientId: workerEnv.GITHUB_CLIENT_ID }).pipe(
  Layer.provide(FetchHttpClient.layer),
);

export default OAuthProvider.make({ env: workerEnv, mcp: mcp.handler, github });
