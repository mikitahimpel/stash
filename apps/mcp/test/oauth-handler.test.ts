// Wiring tests for the `Mcp` Worker on Node: OAuth 2.1 metadata, the bearer check on `/mcp`, the
// GitHub sign-in with one allowlisted login, and MCP `initialize` + `tools/list` with the token the
// flow issued. GitHub is a fake behind `HttpClient`, KV is in memory and the api is
// `@stash/mcp-platform/testing`. All values are synthetic.
import * as Testing from "@stash/mcp-platform/testing";
import { Layer, Redacted } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as GitHub from "../src/github-identity.ts";
import * as McpServer from "../src/mcp-server.ts";
import * as OAuthProvider from "../src/oauth-provider.ts";
import type { WorkerEnv } from "../src/worker-env.ts";

const origin = "https://mcp.example.com";
const resource = `${origin}/mcp`;
const allowedLogin = "synthetic-user";
const clientRedirectUri = "https://client.example.com/callback";
const githubCode = "synthetic-github-code";

/** A KV namespace in memory. Covers what the provider uses: get (text/json), put, delete, list. */
const makeKv = () => {
  const store = new Map<string, string>();
  const kv = {
    get: async (key: string, options?: unknown) => {
      const value = store.get(key);
      if (value === undefined) return null;
      const type = typeof options === "string" ? options : (options as { type?: string })?.type;
      return type === "json" ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async ({ prefix = "" }: { prefix?: string } = {}) => ({
      keys: [...store.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
      cacheStatus: null,
    }),
  };
  return kv as unknown as KVNamespace;
};

const base64Url = (value: Buffer) => value.toString("base64url");

/** Fake GitHub: checks the PKCE pair and answers with whichever login the test signs in as. */
const github = {
  login: allowedLogin,
  challenge: undefined as string | undefined,
  verifiedPkce: false,
};

const fakeGitHubFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  if (request.url === GitHub.accessTokenUrl) {
    const body = new URLSearchParams(await request.text());
    const verifier = body.get("code_verifier") ?? "";
    github.verifiedPkce =
      base64Url(createHash("sha256").update(verifier).digest()) === github.challenge;
    const ok =
      body.get("code") === githubCode &&
      body.get("client_secret") === "synthetic-client-secret" &&
      github.verifiedPkce;
    return Response.json(
      ok ? { access_token: "synthetic-github-token", token_type: "bearer" } : { error: "bad" },
    );
  }
  if (request.url === GitHub.userUrl) {
    return request.headers.get("authorization") === "Bearer synthetic-github-token"
      ? Response.json({ login: github.login, id: 1 })
      : new Response("Unauthorized", { status: 401 });
  }
  return new Response("Not found", { status: 404 });
}) as typeof globalThis.fetch;

const githubLayer = GitHub.layer({
  clientId: "synthetic-client-id",
  clientSecret: Redacted.make("synthetic-client-secret"),
}).pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fakeGitHubFetch)),
);

const mcp = HttpRouter.toWebHandler(McpServer.layer(Testing.layer()), { disableLogger: true });
afterAll(() => mcp.dispose());

const provider = OAuthProvider.make({
  env: { MCP_ORIGIN: origin, ALLOWED_GITHUB_LOGIN: allowedLogin },
  mcp: mcp.handler,
  github: githubLayer,
});

let env: WorkerEnv;
beforeEach(() => {
  env = { OAUTH_KV: makeKv() } as WorkerEnv;
  github.login = allowedLogin;
  github.challenge = undefined;
  github.verifiedPkce = false;
});

const ctx = (): ExecutionContext =>
  ({ waitUntil: () => {}, passThroughOnException: () => {}, props: {} }) as never;

const send = (path: string, init?: RequestInit) =>
  provider.fetch(new Request(new URL(path, origin), init), env as OAuthProvider.ProviderEnv, ctx());

/** Collects `name=value` from Set-Cookie headers into one Cookie header, as a browser would. */
const cookies = (...responses: ReadonlyArray<Response>) =>
  responses
    .flatMap((response) => response.headers.getSetCookie())
    .map((cookie) => cookie.split(";")[0]!)
    .filter((cookie) => !cookie.endsWith("="))
    .join("; ");

const registerClient = async () => {
  const response = await send("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Synthetic Client",
      redirect_uris: [clientRedirectUri],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(response.status).toBe(201);
  const { client_id } = (await response.json()) as { client_id: string };
  return client_id;
};

const clientVerifier = "synthetic-client-verifier-0123456789-abcdefghijklmnop";
const clientChallenge = base64Url(createHash("sha256").update(clientVerifier).digest());

/** Runs the browser part of the flow and returns the client's final redirect. */
const authorize = async (clientId: string) => {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: clientRedirectUri,
    state: "client-state",
    code_challenge: clientChallenge,
    code_challenge_method: "S256",
    resource,
  });
  const page = await send(`/authorize?${query}`);
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain("Synthetic Client");
  expect(html).toContain("client.example.com");
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  expect(handle).toBeDefined();

  const approve = await send("/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies(page) },
    body: new URLSearchParams({ handle: handle!, decision: "approve" }),
  });
  expect(approve.status).toBe(302);
  const toGitHub = new URL(approve.headers.get("location")!);
  expect(`${toGitHub.origin}${toGitHub.pathname}`).toBe(GitHub.authorizeUrl);
  expect(toGitHub.searchParams.get("client_id")).toBe("synthetic-client-id");
  expect(toGitHub.searchParams.get("redirect_uri")).toBe(`${origin}/callback`);
  expect(toGitHub.searchParams.get("code_challenge_method")).toBe("S256");
  github.challenge = toGitHub.searchParams.get("code_challenge")!;

  const callback = new URLSearchParams({
    code: githubCode,
    state: toGitHub.searchParams.get("state")!,
  });
  const back = await send(`/callback?${callback}`, { headers: { cookie: cookies(approve) } });
  expect(back.status).toBe(302);
  return new URL(back.headers.get("location")!);
};

const exchange = async (clientId: string, code: string) => {
  const response = await send("/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: clientRedirectUri,
      code_verifier: clientVerifier,
      resource,
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { access_token: string; token_type: string };
  expect(body.token_type.toLowerCase()).toBe("bearer");
  return body.access_token;
};

const issueToken = async () => {
  const clientId = await registerClient();
  const redirect = await authorize(clientId);
  return exchange(clientId, redirect.searchParams.get("code")!);
};

/** One JSON-RPC message over Streamable HTTP. The reply may be JSON or a one-event SSE stream. */
const rpc = async (
  token: string,
  message: Record<string, unknown>,
  headers: Record<string, string> = {},
) => {
  const response = await send("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
  });
  const text = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .at(-1)
    : text;
  return { response, body: json ? (JSON.parse(json) as Record<string, any>) : undefined };
};

describe("OAuth metadata", () => {
  it("serves authorization server metadata (RFC 8414)", async () => {
    const response = await send("/.well-known/oauth-authorization-server");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("serves protected resource metadata for /mcp (RFC 9728)", async () => {
    const response = await send("/.well-known/oauth-protected-resource/mcp");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource,
      authorization_servers: [origin],
    });
  });
});

describe("MCP endpoint", () => {
  it("answers 401 with a resource_metadata challenge without a token", async () => {
    const response = await send("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("answers 401 to an unknown token", async () => {
    const { response } = await rpc("unknown-token", { id: 1, method: "tools/list" });
    expect(response.status).toBe(401);
  });
});

describe("GitHub sign-in", () => {
  it("issues a grant to the allowlisted login, with GitHub PKCE", async () => {
    const clientId = await registerClient();
    const redirect = await authorize(clientId);
    expect(github.verifiedPkce).toBe(true);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(clientRedirectUri);
    expect(redirect.searchParams.get("state")).toBe("client-state");
    expect(redirect.searchParams.get("code")).toBeTruthy();
    expect(await exchange(clientId, redirect.searchParams.get("code")!)).toBeTruthy();
  });

  it("matches the allowlisted login case-insensitively, as GitHub does", async () => {
    github.login = "Synthetic-User";
    const redirect = await authorize(await registerClient());
    expect(redirect.searchParams.get("code")).toBeTruthy();
  });

  it("denies any other GitHub login", async () => {
    github.login = "someone-else";
    const redirect = await authorize(await registerClient());
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("client-state");
    expect(redirect.searchParams.has("code")).toBe(false);
  });

  it("refuses the callback without the browser-binding cookie", async () => {
    const response = await send(`/callback?code=${githubCode}&state=forged`);
    expect(response.status).toBe(400);
  });
});

describe("MCP with an issued token", () => {
  it("handles initialize and tools/list (2025-06-18, sessionful)", async () => {
    const token = await issueToken();
    const init = await rpc(token, {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "synthetic-client", version: "0.0.0" },
      },
    });
    expect(init.response.status).toBe(200);
    expect(init.body).toMatchObject({
      id: 1,
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "stash" } },
    });
    const session = init.response.headers.get("mcp-session-id");
    expect(session).toBeTruthy();
    const headers = { "mcp-session-id": session!, "mcp-protocol-version": "2025-06-18" };

    const initialized = await rpc(token, { method: "notifications/initialized" }, headers);
    expect(initialized.response.status).toBe(202);

    const list = await rpc(token, { id: 2, method: "tools/list" }, headers);
    expect(list.response.status).toBe(200);
    expect(list.body).toMatchObject({ id: 2, result: { tools: [] } });
  });

  it("handles tools/list without a session (2026-07-28)", async () => {
    const token = await issueToken();
    const list = await rpc(
      token,
      {
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
      { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" },
    );
    expect(list.body).toMatchObject({ id: 1, result: { tools: [] } });
    expect(list.response.status).toBe(200);
  });
});
