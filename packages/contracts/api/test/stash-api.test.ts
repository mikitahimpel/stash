import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import { HttpClient, type HttpClientRequest } from "effect/http";
import { HttpApiClient, HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api";
import * as Api from "../src/stash-api.ts";
import * as Security from "../src/security.ts";

const routes = [
  ["links", "save", "POST", "/links"],
  ["links", "saveBatch", "POST", "/links/batch"],
  ["links", "list", "GET", "/links"],
  ["links", "get", "GET", "/links/:id"],
  ["links", "update", "PATCH", "/links/:id"],
  ["links", "remove", "DELETE", "/links/:id"],
  ["search", "search", "GET", "/search"],
  ["tabs", "report", "PUT", "/devices/:id/tabs"],
  ["tabs", "list", "GET", "/tabs"],
  ["tabs", "archive", "POST", "/tabs/archive"],
  ["devices", "list", "GET", "/devices"],
  ["devices", "register", "POST", "/devices"],
  ["devices", "sendCommand", "POST", "/devices/:id/commands"],
  ["devices", "listCommands", "GET", "/devices/:id/commands"],
  ["devices", "ackCommand", "POST", "/commands/:id/ack"],
  ["tokens", "list", "GET", "/tokens"],
  ["tokens", "create", "POST", "/tokens"],
  ["tokens", "revoke", "DELETE", "/tokens/:id"],
  ["auth", "me", "GET", "/auth/me"],
  ["auth", "deviceStart", "POST", "/auth/device/start"],
  ["auth", "devicePoll", "POST", "/auth/device/poll"],
  ["auth", "logout", "POST", "/auth/logout"],
  ["digest", "latest", "GET", "/digest/latest"],
] as const;

// Loosely typed view of the definition, for reflection only.
interface EndpointShape {
  readonly method: string;
  readonly path: string;
  readonly middlewares: ReadonlySet<unknown>;
}
interface GroupShape {
  readonly endpoints: Record<string, EndpointShape>;
}
const groups = Api.StashApi.groups as unknown as Record<string, GroupShape>;

const endpoint = (group: string, name: string): EndpointShape => {
  const found = groups[group]?.endpoints[name];
  if (found === undefined) throw new Error(`missing endpoint ${group}.${name}`);
  return found;
};

// Group-level middleware is copied onto each endpoint, so the endpoint is the place to look.
const isGuarded = (group: string, name: string) =>
  endpoint(group, name).middlewares.has(Security.Authorization);

const spec = OpenApi.fromApi(Api.StashApi);

// Response statuses as published in the OpenAPI document, without the generic 400 for bad input.
const statuses = (group: string, name: string) => {
  const { method, path } = endpoint(group, name);
  const operation = (spec.paths as Record<string, Record<string, { responses: object }>>)[
    path.replace(/:(\w+)/g, "{$1}")
  ]?.[method.toLowerCase()];
  return Object.keys(operation?.responses ?? {})
    .filter((status) => status !== "400")
    .sort();
};

describe("StashApi", () => {
  it("has exactly the documented groups", () => {
    expect(Object.keys(groups).sort()).toEqual(
      ["auth", "devices", "digest", "links", "search", "tabs", "tokens"].sort(),
    );
  });

  it.each(routes)("%s.%s is %s %s", (group, name, method, path) => {
    expect(endpoint(group, name).method).toBe(method);
    expect(endpoint(group, name).path).toBe(path);
  });

  it("has no undocumented endpoints", () => {
    const all = Object.entries(groups).flatMap(([group, { endpoints }]) =>
      Object.keys(endpoints).map((name) => `${group}.${name}`),
    );
    expect(all.sort()).toEqual(routes.map(([group, name]) => `${group}.${name}`).sort());
  });

  it("guards every endpoint except the device login flow", () => {
    const open = routes
      .filter(([group, name]) => !isGuarded(group, name))
      .map(([group, name]) => `${group}.${name}`);
    expect(open).toEqual(["auth.deviceStart", "auth.devicePoll"]);
  });

  it.each([
    ["links", "save", ["201", "401", "429"]],
    ["links", "saveBatch", ["201", "401", "429"]],
    ["links", "list", ["200", "401"]],
    ["links", "get", ["200", "401", "404"]],
    ["links", "remove", ["204", "401", "404"]],
    ["tabs", "report", ["204", "401", "403", "404"]],
    ["tabs", "archive", ["201", "401", "404", "429"]],
    ["devices", "listCommands", ["200", "401", "403", "404"]],
    ["devices", "ackCommand", ["200", "401", "403", "404", "409"]],
    ["tokens", "create", ["201", "401", "404"]],
    ["auth", "deviceStart", ["200"]],
    ["auth", "devicePoll", ["200", "403", "410"]],
    ["auth", "logout", ["204", "401"]],
    ["digest", "latest", ["200", "401", "404"]],
  ] as const)("%s.%s responds with %j", (group, name, expected) => {
    expect(statuses(group, name)).toEqual(expected);
  });

  it("builds an OpenAPI document with both security schemes", () => {
    expect(spec.info.title).toBe("Stash API");
    expect(Object.keys(spec.paths).sort()).toEqual(
      [...new Set(routes.map(([, , , path]) => path.replace(/:(\w+)/g, "{$1}")))].sort(),
    );
    expect(spec.components.securitySchemes).toMatchObject({
      bearer: { type: "http", scheme: "Bearer" },
      session: { type: "apiKey", in: "cookie", name: Security.sessionCookieName },
    });
  });

  it("authorizes by bearer token first, then by session cookie", () => {
    expect(Object.keys(Security.Authorization.security)).toEqual(["bearer", "session"]);
    expect(Security.Authorization.security.bearer).toBe(HttpApiSecurity.bearer);
    expect(Security.Authorization.requiredForClient).toBe(true);
  });
});

describe("HttpApiClient", () => {
  it.effect("can be derived and encodes requests from the definition", () =>
    Effect.gen(function* () {
      const sent: Array<HttpClientRequest.HttpClientRequest> = [];
      // Records each request and never answers: this test is about encoding, not transport.
      const recorder = HttpClient.make((request) => {
        sent.push(request);
        return Effect.die("stub transport");
      });
      const client = yield* HttpApiClient.make(Api.StashApi, {
        baseUrl: "https://api.example.com",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(HttpClient.HttpClient, recorder),
            HttpApiMiddleware.layerClient(Security.Authorization, ({ next, request }) =>
              next(request),
            ),
          ),
        ),
      );

      expect(Object.keys(client).sort()).toEqual(
        ["auth", "devices", "digest", "links", "search", "tabs", "tokens"].sort(),
      );

      const exit = yield* client.links
        .list({ query: { seen: false, limit: 10, sort: "recent" } })
        .pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.method).toBe("GET");
      expect(sent[0]!.url).toBe("https://api.example.com/links");
      expect(Object.fromEntries(sent[0]!.urlParams)).toEqual({
        seen: "false",
        limit: "10",
        sort: "recent",
      });
    }),
  );
});
