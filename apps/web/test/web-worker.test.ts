import { describe, expect, it } from "vitest";
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
  return { env: { API: fetcher("api"), ASSETS: fetcher("assets") }, seen };
};

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
});
