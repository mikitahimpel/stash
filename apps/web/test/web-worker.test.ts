import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import * as AppRouter from "../src/app-router.ts";
import WebWorker, { type Fetcher } from "../src/web-worker.ts";

// Records what reaches each binding and answers with its name.
const bindings = () => {
  const seen: Array<{ binding: string; request: Request }> = [];
  const fetcher = (binding: string): Fetcher => ({
    fetch: (request) => {
      seen.push({ binding, request });
      return Promise.resolve(new Response(binding));
    },
  });
  return { env: { API: fetcher("api"), ASSETS: fetcher("assets") }, seen, fetcher };
};

// A stage on a custom domain: the site and the MCP server share `stash.example.com`, and the
// Worker still answers on its old `workers.dev` host.
const site = "https://stash.example.com";
const oldHost = "https://stash-web.example-account.workers.dev";
const moved = () => {
  const { env, seen, fetcher } = bindings();
  return { env: { ...env, MCP: fetcher("mcp"), STASH_WEB_ORIGIN: site }, seen };
};

// Every path the `Mcp` Worker serves (see apps/mcp/src/oauth-provider.ts).
const mcpPaths = [
  "/mcp",
  "/authorize",
  "/authorize/device",
  "/authorize/poll",
  "/token",
  "/register",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
];

describe("web worker", () => {
  it("forwards /api/* to the api with the prefix stripped, keeping method, headers and body", async () => {
    const { env, seen } = bindings();
    const response = await WebWorker.fetch(
      new Request("https://web.example.com/api/auth/device/poll?x=1", {
        method: "POST",
        headers: {
          authorization: "Bearer synthetic",
          "cf-connecting-ip": "192.0.2.1",
          "content-type": "application/json",
        },
        body: JSON.stringify({ flowId: "flow-1" }),
      }),
      env,
    );
    expect(await response.text()).toBe("api");
    const forwarded = seen[0]!.request;
    expect(seen.map((s) => s.binding)).toEqual(["api"]);
    expect(forwarded.url).toBe("https://web.example.com/auth/device/poll?x=1");
    expect(forwarded.method).toBe("POST");
    // happy-dom drops the browser-forbidden `cookie` header, so other headers stand in for it.
    expect(forwarded.headers.get("authorization")).toBe("Bearer synthetic");
    expect(forwarded.headers.get("cf-connecting-ip")).toBe("192.0.2.1");
    expect(await forwarded.json()).toEqual({ flowId: "flow-1" });
  });

  it("serves everything else from the assets", async () => {
    const { env, seen } = bindings();
    for (const path of ["/", "/links", "/apix", "/assets/index.js"]) {
      await WebWorker.fetch(new Request(`https://web.example.com${path}`), env);
    }
    expect(seen.map((s) => s.binding)).toEqual(["assets", "assets", "assets", "assets"]);
  });

  it("maps web paths to api paths", async () => {
    const { env, seen } = bindings();
    for (const path of ["/api", "/api/", "/api/health", "/apis/health", "/links"]) {
      await WebWorker.fetch(new Request(`https://web.example.com${path}`), env);
    }
    expect(seen.map((s) => [s.binding, new URL(s.request.url).pathname])).toEqual([
      ["api", "/"],
      ["api", "/"],
      ["api", "/health"],
      ["assets", "/apis/health"],
      ["assets", "/links"],
    ]);
  });

  it("serves the MCP server and its OAuth endpoints on the site's own host, URL unchanged", async () => {
    const { env, seen } = moved();
    for (const path of mcpPaths) {
      await WebWorker.fetch(new Request(`${site}${path}?x=1`, { method: "POST" }), env);
    }
    expect(seen.map((s) => [s.binding, s.request.url])).toEqual(
      mcpPaths.map((path) => ["mcp", `${site}${path}?x=1`]),
    );
    expect(seen.every((s) => s.request.method === "POST")).toBe(true);
  });

  it("keeps the pages that only look like MCP paths", async () => {
    const { env, seen } = moved();
    for (const path of ["/mcpx", "/tokens", "/registered", "/.well-known/security.txt", "/links"]) {
      await WebWorker.fetch(new Request(`${site}${path}`), env);
    }
    expect(seen.map((s) => s.binding)).toEqual(["assets", "assets", "assets", "assets", "assets"]);
  });

  it("serves no MCP path without the binding", async () => {
    const { env, seen } = bindings();
    await WebWorker.fetch(new Request(`${site}/mcp`), { ...env, STASH_WEB_ORIGIN: site });
    expect(seen.map((s) => s.binding)).toEqual(["assets"]);
  });

  it("no route of the SPA is an MCP path", () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [...AppRouter.routes] });
    for (const path of mcpPaths) {
      // Only the catch-all (which redirects to the Inbox) may match.
      expect(router.resolve(path).matched.map((record) => record.path)).toEqual([
        "/:pathMatch(.*)*",
      ]);
    }
  });

  it("redirects a GET on the old workers.dev host to the same page on the new host", async () => {
    const { env, seen } = moved();
    for (const [method, path] of [
      ["GET", "/"],
      ["GET", "/links/abc?from=inbox"],
      ["GET", "/save?device=d-1&url=https%3A%2F%2Fexample.com%2Fa"],
      ["HEAD", "/settings"],
      // The old web host never served the MCP server.
      ["GET", "/mcp"],
    ] as const) {
      const response = await WebWorker.fetch(new Request(`${oldHost}${path}`, { method }), env);
      expect(response.status).toBe(301);
      expect(response.headers.get("location")).toBe(`${site}${path}`);
    }
    expect(seen).toEqual([]);
  });

  it("keeps serving the api on the old host, with any method", async () => {
    const { env, seen } = moved();
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await WebWorker.fetch(new Request(`${oldHost}/api/links`, { method }), env);
      expect(response.status).toBe(200);
    }
    expect(seen.map((s) => [s.binding, s.request.url])).toEqual([
      ["api", `${oldHost}/links`],
      ["api", `${oldHost}/links`],
      ["api", `${oldHost}/links`],
    ]);
  });

  it("does not redirect a request that is not a GET", async () => {
    const { env, seen } = moved();
    const response = await WebWorker.fetch(
      new Request(`${oldHost}/links`, { method: "POST" }),
      env,
    );
    expect(response.status).toBe(200);
    expect(seen.map((s) => s.binding)).toEqual(["assets"]);
  });

  it("does not redirect a stage that lives on workers.dev, or a local host", async () => {
    const { env, seen } = bindings();
    await WebWorker.fetch(new Request(`${oldHost}/links`), { ...env, STASH_WEB_ORIGIN: oldHost });
    await WebWorker.fetch(new Request(`${oldHost}/links`), env);
    await WebWorker.fetch(new Request("http://localhost:8791/links"), {
      ...env,
      STASH_WEB_ORIGIN: "http://localhost:5173",
    });
    expect(seen.map((s) => s.binding)).toEqual(["assets", "assets", "assets"]);
  });

  // A WebSocket upgrade under `/api` (the api's live events) needs the api's own answer: a copy
  // of a 101 would lose its socket. happy-dom drops the `upgrade` request header, so only the
  // answer is checked.
  it("returns the api's answer as is", async () => {
    const { env } = moved();
    const answer = new Response("events");
    const response = await WebWorker.fetch(new Request(`${site}/api/events`), {
      ...env,
      API: { fetch: () => Promise.resolve(answer) },
    });
    expect(response).toBe(answer);
  });
});
