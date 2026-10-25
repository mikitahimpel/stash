import * as ApiClient from "@stash/mcp-platform/api-client";
import * as Testing from "@stash/mcp-platform/testing";
import { Context, Effect, Layer } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import { HttpRouter } from "effect/http";
import * as LinksTools from "../src/links-tools.ts";

// An MCP client for tests: JSON-RPC over Streamable HTTP against an in-process MCP server with the
// link tools registered and the fake api from `@stash/mcp-platform/testing` behind them.

const protocolVersion = "2026-07-28";

export interface CallToolResult {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text: string }>;
  readonly structuredContent?: any;
  readonly isError?: boolean;
}

export interface Rpc {
  readonly error?: { readonly code: number; readonly message: string };
  readonly result?: any;
}

export class McpClient extends Context.Service<
  McpClient,
  {
    readonly request: (method: string, params?: Record<string, unknown>) => Effect.Effect<Rpc>;
    readonly callTool: (
      name: string,
      args: Record<string, unknown>,
    ) => Effect.Effect<CallToolResult>;
  }
>()("test/McpClient") {}

const server = (api: ApiClient.StashApiClient["Service"]) =>
  LinksTools.layer.pipe(
    Layer.provideMerge(
      McpServer.layerHttp({
        name: "test",
        version: "0.0.0",
        path: "/mcp",
        protocols: [McpProtocol.v2026_07_28],
      }),
    ),
    Layer.provide(Layer.succeed(ApiClient.StashApiClient, api)),
    Layer.orDie,
  );

/** The MCP client plus the fake api's `TestApi` controls, both built from `seed`. */
export const layer = (seed: Testing.Seed = {}): Layer.Layer<McpClient | Testing.TestApi> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const api = yield* ApiClient.StashApiClient;
      const testApi = yield* Testing.TestApi;
      const web = yield* Effect.acquireRelease(
        Effect.sync(() => HttpRouter.toWebHandler(server(api), { disableLogger: true })),
        (web) => Effect.promise(() => web.dispose()),
      );
      let id = 0;
      const request = (method: string, params: Record<string, unknown> = {}) =>
        Effect.promise(async () => {
          id += 1;
          const response = await web.handler(
            new Request("https://mcp.example.com/mcp", {
              method: "POST",
              headers: {
                accept: "application/json, text/event-stream",
                "content-type": "application/json",
                "mcp-protocol-version": protocolVersion,
                "mcp-method": method,
                ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id,
                method,
                params: {
                  ...params,
                  _meta: {
                    "io.modelcontextprotocol/protocolVersion": protocolVersion,
                    "io.modelcontextprotocol/clientCapabilities": {},
                  },
                },
              }),
            }),
          );
          const text = await response.text();
          const json = response.headers.get("content-type")?.includes("text/event-stream")
            ? text
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim())
                .at(-1)!
            : text;
          return JSON.parse(json) as Rpc;
        });
      return Context.make(Testing.TestApi, testApi).pipe(
        Context.add(McpClient, {
          request,
          callTool: (name, args) =>
            Effect.flatMap(request("tools/call", { name, arguments: args }), (rpc) =>
              rpc.result === undefined
                ? Effect.die(new Error(`tools/call ${name} failed: ${JSON.stringify(rpc.error)}`))
                : Effect.succeed(rpc.result as CallToolResult),
            ),
        }),
      );
    }),
  ).pipe(Layer.provide(Testing.layer(seed)));
