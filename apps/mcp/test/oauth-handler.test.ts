// Wiring tests for the `Mcp` Worker on Node: OAuth 2.1 metadata, the bearer check on `/mcp`, the
// GitHub Device Flow sign-in with one allowlisted login, and MCP `initialize` + `tools/list` with
// the token the flow issued. GitHub is a fake behind `HttpClient`, KV is in memory, the clock is the
// test's and the api is `@stash/mcp-platform/testing`. All values are synthetic.
import * as Testing from "@stash/mcp-platform/testing";
import { Layer } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as GitHub from "../src/github-identity.ts";
import * as McpServer from "../src/mcp-server.ts";
import * as OAuthHandler from "../src/oauth-handler.ts";
import * as OAuthProvider from "../src/oauth-provider.ts";
import type { WorkerEnv } from "../src/worker-env.ts";

const origin = "https://mcp.example.com";
const resource = `${origin}/mcp`;
const allowedLogin = "synthetic-user";
const clientRedirectUri = "https://client.example.com/callback";
const clientId = "synthetic-client-id";
const deviceCode = "synthetic-device-code";
const userCode = "WDJB-MJHT";
const githubToken = "synthetic-github-token";

/** A KV namespace in memory. Covers what the provider uses: get (text/json), put, delete, list. */
const makeKv = (store: Map<string, string>) => {
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

type TokenAnswer = "authorization_pending" | "slow_down" | "expired_token" | "access_denied";

/**
 * Fake GitHub. The token endpoint answers from `answers` in order, then with a token. `bodies`
 * records every form GitHub received, so tests can check that no client secret is ever sent.
 */
const github = {
  login: allowedLogin,
  answers: [] as Array<TokenAnswer>,
  tokenPolls: 0,
  bodies: [] as Array<URLSearchParams>,
};

const fakeGitHubFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  if (request.url === GitHub.deviceCodeUrl) {
    const body = new URLSearchParams(await request.text());
    github.bodies.push(body);
    if (body.get("client_id") !== clientId || body.get("scope") !== "read:user") {
      return Response.json({ error: "incorrect_client_credentials" });
    }
    return Response.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
  }
  if (request.url === GitHub.accessTokenUrl) {
    const body = new URLSearchParams(await request.text());
    github.bodies.push(body);
    github.tokenPolls += 1;
    const ok =
      body.get("client_id") === clientId &&
      body.get("device_code") === deviceCode &&
      body.get("grant_type") === "urn:ietf:params:oauth:grant-type:device_code";
    if (!ok) return Response.json({ error: "bad_verification_code" });
    const answer = github.answers.shift();
    return Response.json(
      answer === undefined
        ? { access_token: githubToken, token_type: "bearer" }
        : { error: answer },
    );
  }
  if (request.url === GitHub.userUrl) {
    return request.headers.get("authorization") === `Bearer ${githubToken}`
      ? Response.json({ login: github.login, id: 1 })
      : new Response("Unauthorized", { status: 401 });
  }
  return new Response("Not found", { status: 404 });
}) as typeof globalThis.fetch;

const githubLayer = GitHub.layer({ clientId }).pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fakeGitHubFetch)),
);

// Every registered tool, in registration order.
const expectedTools = [
  { name: "save_link", annotations: { readOnlyHint: false, openWorldHint: false } },
  { name: "search_links", annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "list_links", annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "get_link", annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "set_link_status", annotations: { destructiveHint: false, idempotentHint: true } },
  { name: "list_open_tabs", annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: "archive_tab", annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "close_tab_on_device", annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: "get_latest_digest", annotations: { readOnlyHint: true, destructiveHint: false } },
];

const mcp = HttpRouter.toWebHandler(McpServer.layer(Testing.layer()), { disableLogger: true });
afterAll(() => mcp.dispose());

/** The test's clock, in epoch milliseconds. Polls advance it past GitHub's interval. */
let clock = 0;

const provider = OAuthProvider.make({
  env: { MCP_ORIGIN: origin, ALLOWED_GITHUB_LOGIN: allowedLogin },
  mcp: mcp.handler,
  github: githubLayer,
  now: () => clock,
});

let kvStore: Map<string, string>;
let env: WorkerEnv;
beforeEach(() => {
  kvStore = new Map();
  env = { OAUTH_KV: makeKv(kvStore) } as WorkerEnv;
  clock = Date.UTC(2026, 0, 1);
  github.login = allowedLogin;
  github.answers = [];
  github.tokenPolls = 0;
  github.bodies = [];
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

/** Opens the consent page for a new authorization request and returns it with its form handle. */
const consent = async (oauthClientId: string) => {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: oauthClientId,
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
  return { page, handle: handle! };
};

/** Approves the consent page and opens the device code page. Returns the poll `state` + cookie. */
const startDeviceFlow = async (oauthClientId: string) => {
  const { page, handle } = await consent(oauthClientId);
  const approve = await send("/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies(page) },
    body: new URLSearchParams({ handle, decision: "approve" }),
  });
  expect(approve.status).toBe(303);
  const toDevice = new URL(approve.headers.get("location")!);
  expect(`${toDevice.origin}${toDevice.pathname}`).toBe(`${origin}${OAuthHandler.devicePath}`);
  const state = toDevice.searchParams.get("state")!;

  const device = await send(`${toDevice.pathname}${toDevice.search}`);
  expect(device.status).toBe(200);
  expect(device.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  const html = await device.text();
  expect(html).toContain(userCode);
  expect(html).toContain('href="https://github.com/login/device"');
  expect(html).toContain("prefers-color-scheme");
  expect(html).not.toContain(deviceCode);
  return { state, cookie: cookies(approve) };
};

const pollOnce = async (state: string, cookie: string) => {
  const response = await send(OAuthHandler.pollPath, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ state }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as OAuthHandler.PollResponse;
};

/** Polls as the device page does, waiting out each interval, until the flow ends. */
const pollUntilDone = async (state: string, cookie: string) => {
  const seen: Array<OAuthHandler.PollResponse> = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    const last = seen.at(-1);
    clock += (last && "interval" in last ? last.interval : 5) * 1000;
    const body = await pollOnce(state, cookie);
    seen.push(body);
    if (body.status !== "pending" && body.status !== "slow_down") return seen;
  }
  throw new Error("the device flow never ended");
};

/** Runs the browser part of the flow and returns the final poll answer and every answer before. */
const authorize = async (oauthClientId: string) => {
  const { state, cookie } = await startDeviceFlow(oauthClientId);
  const seen = await pollUntilDone(state, cookie);
  return { final: seen.at(-1)!, seen };
};

const redirectOf = (body: OAuthHandler.PollResponse) => {
  expect("redirectTo" in body && body.redirectTo).toBeTruthy();
  return new URL((body as { redirectTo: string }).redirectTo);
};

const grants = () => [...kvStore.keys()].filter((key) => key.startsWith("grant:"));

const exchange = async (oauthClientId: string, code: string) => {
  const response = await send("/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: oauthClientId,
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
  const oauthClientId = await registerClient();
  const { final } = await authorize(oauthClientId);
  return exchange(oauthClientId, redirectOf(final).searchParams.get("code")!);
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

describe("GitHub Device Flow sign-in", () => {
  it("issues a grant to the allowlisted login after pending and slow_down", async () => {
    github.answers = ["authorization_pending", "slow_down"];
    const oauthClientId = await registerClient();
    const { final, seen } = await authorize(oauthClientId);
    expect(seen.map((body) => body.status)).toEqual(["pending", "slow_down", "complete"]);
    expect(seen[0]).toMatchObject({ interval: 5 });
    expect(seen[1]).toMatchObject({ interval: 10 });
    const redirect = redirectOf(final);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(clientRedirectUri);
    expect(redirect.searchParams.get("state")).toBe("client-state");
    expect(redirect.searchParams.get("code")).toBeTruthy();
    expect(grants()).toHaveLength(1);
    expect(await exchange(oauthClientId, redirect.searchParams.get("code")!)).toBeTruthy();
  });

  it("never sends a client secret and never stores the GitHub token", async () => {
    await authorize(await registerClient());
    expect(github.bodies.length).toBeGreaterThan(0);
    for (const body of github.bodies) expect(body.has("client_secret")).toBe(false);
    const stored = [...kvStore.entries()].flat().join("\n");
    expect(stored).not.toContain(githubToken);
    expect(stored).not.toContain(deviceCode);
  });

  it("does not poll GitHub before the interval has passed", async () => {
    const { state, cookie } = await startDeviceFlow(await registerClient());
    expect(await pollOnce(state, cookie)).toEqual({ status: "pending", interval: 5 });
    expect(github.tokenPolls).toBe(0);
  });

  it("matches the allowlisted login case-insensitively, as GitHub does", async () => {
    github.login = "Synthetic-User";
    const { final } = await authorize(await registerClient());
    expect(final.status).toBe("complete");
    expect(redirectOf(final).searchParams.get("code")).toBeTruthy();
  });

  it("denies any other GitHub login without a grant", async () => {
    github.login = "someone-else";
    const { final } = await authorize(await registerClient());
    expect(final).toMatchObject({
      status: "not_allowed",
      message: "This GitHub account may not use this server",
    });
    const redirect = redirectOf(final);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("client-state");
    expect(redirect.searchParams.has("code")).toBe(false);
    expect(grants()).toEqual([]);
  });

  it.each([
    ["expired_token", "expired"],
    ["access_denied", "denied"],
  ] as const)("ends the flow on %s without a grant", async (answer, status) => {
    github.answers = [answer];
    const { final } = await authorize(await registerClient());
    expect(final.status).toBe(status);
    expect(redirectOf(final).searchParams.get("error")).toBe("access_denied");
    expect(grants()).toEqual([]);
  });

  it("gives no grant to a poll without the browser-binding cookie", async () => {
    const { state } = await startDeviceFlow(await registerClient());
    clock += 5000;
    const body = await pollOnce(state, "");
    expect(body.status).toBe("failed");
    expect("redirectTo" in body).toBe(false);
    expect(grants()).toEqual([]);
  });

  it("answers expired to an unknown flow", async () => {
    expect((await pollOnce("forged", "")).status).toBe("expired");
    expect(github.tokenPolls).toBe(0);
  });

  it("returns access_denied to the client when consent is denied", async () => {
    const { page, handle } = await consent(await registerClient());
    const deny = await send("/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies(page) },
      body: new URLSearchParams({ handle, decision: "deny" }),
    });
    expect(deny.status).toBe(302);
    const redirect = new URL(deny.headers.get("location")!);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(github.bodies).toEqual([]);
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
    expect(list.body).toMatchObject({ id: 2, result: { tools: expectedTools } });

    // A tool call goes through the api client to the fake api, which has no digest yet.
    const call = await rpc(
      token,
      { id: 3, method: "tools/call", params: { name: "get_latest_digest", arguments: {} } },
      headers,
    );
    expect(call.response.status).toBe(200);
    expect(call.body).toMatchObject({
      id: 3,
      result: { isError: false, structuredContent: { digest: null } },
    });
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
    expect(list.body).toMatchObject({ id: 1, result: { tools: expectedTools } });
    expect(list.response.status).toBe(200);
  });

  it("calls a link tool with the issued token (2026-07-28)", async () => {
    const token = await issueToken();
    const call = await rpc(
      token,
      {
        id: 1,
        method: "tools/call",
        params: {
          name: "save_link",
          arguments: { url: "https://example.com/from-claude" },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
      { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "save_link" },
    );
    expect(call.response.status).toBe(200);
    expect(call.body).toMatchObject({
      id: 1,
      result: {
        isError: false,
        structuredContent: { url: "https://example.com/from-claude", status: "new" },
      },
    });
    expect(call.body?.result.content[0].text).toContain("Saved https://example.com/from-claude");
  });
});
