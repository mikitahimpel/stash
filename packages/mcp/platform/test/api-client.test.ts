import { assert, describe, it } from "@effect/vitest";
import * as Errors from "@stash/contracts-domain/errors";
import { Effect, Redacted } from "effect";
import * as ApiClient from "../src/api-client.ts";

// Synthetic placeholder, not a real token.
const token = "synthetic-live-token";

const digest = {
  periodStart: "2026-01-01T00:00:00.000Z",
  periodEnd: "2026-01-08T00:00:00.000Z",
  generatedAt: "2026-01-08T00:00:00.000Z",
  totals: { saved: 3, seen: 2, done: 1, archived: 0 },
  topTags: [],
  topTypes: [],
  highlights: [],
};

/** A binding that records each request and answers with `respond`. */
const recordingBinding = (respond: (request: Request) => Response) => {
  const requests: Array<Request> = [];
  const binding: Fetcher = {
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return respond(request);
    },
    connect: () => {
      throw new Error("not used");
    },
  };
  return { binding, requests };
};

describe("ApiClient.layer", () => {
  it.effect("sends requests through the binding with the bearer token", () => {
    const { binding, requests } = recordingBinding(() => Response.json(digest));
    return Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;
      const latest = yield* client.digest.latest();

      assert.strictEqual(latest.totals.saved, 3);
      assert.strictEqual(requests.length, 1);
      const [request] = requests;
      assert.strictEqual(request!.method, "GET");
      assert.strictEqual(request!.url, `${ApiClient.baseUrl}/digest/latest`);
      assert.strictEqual(request!.headers.get("authorization"), `Bearer ${token}`);
    }).pipe(Effect.provide(ApiClient.layer({ API: binding }, { token: Redacted.make(token) })));
  });

  it.effect("decodes api errors into domain errors", () => {
    const { binding } = recordingBinding(() =>
      Response.json({ _tag: "Unauthorized", message: "Invalid token" }, { status: 401 }),
    );
    return Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;
      const error = yield* client.links.list({ query: {} }).pipe(Effect.flip);
      assert.instanceOf(error, Errors.Unauthorized);
    }).pipe(Effect.provide(ApiClient.layer({ API: binding }, { token: Redacted.make(token) })));
  });
});

describe("GrantApiToken", () => {
  it.effect("sends the current request's grant token instead of the fallback", () => {
    const { binding, requests } = recordingBinding(() => Response.json(digest));
    return Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;
      yield* client.digest
        .latest()
        .pipe(
          Effect.provideService(ApiClient.GrantApiToken, Redacted.make("synthetic-grant-token")),
        );
      yield* client.digest.latest();
      assert.deepStrictEqual(
        requests.map((request) => request.headers.get("authorization")),
        ["Bearer synthetic-grant-token", `Bearer ${token}`],
      );
    }).pipe(Effect.provide(ApiClient.layer({ API: binding }, { token: Redacted.make(token) })));
  });

  it.effect("sends no bearer token without a grant token or fallback", () => {
    const { binding, requests } = recordingBinding(() => Response.json(digest));
    return Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;
      yield* client.digest.latest();
      assert.isNull(requests[0]!.headers.get("authorization"));
    }).pipe(Effect.provide(ApiClient.layer({ API: binding })));
  });
});

describe("createMcpToken", () => {
  it.effect("posts the login to /internal/mcp-tokens and returns the token redacted", () => {
    const { binding, requests } = recordingBinding(() =>
      Response.json(
        {
          id: "token-1",
          deviceId: null,
          name: "Claude (MCP)",
          createdAt: "2026-01-02T03:04:05.000Z",
          revokedAt: null,
          token: "synthetic-minted-token",
        },
        { status: 201 },
      ),
    );
    return Effect.gen(function* () {
      const minted = yield* ApiClient.createMcpToken({ API: binding }, "synthetic-user");
      assert.isTrue(Redacted.isRedacted(minted));
      assert.strictEqual(Redacted.value(minted), "synthetic-minted-token");
      const [request] = requests;
      assert.strictEqual(request!.method, "POST");
      assert.strictEqual(request!.url, `${ApiClient.baseUrl}/internal/mcp-tokens`);
      assert.isNull(request!.headers.get("authorization"));
      assert.deepStrictEqual(yield* Effect.promise(() => request!.json()), {
        login: "synthetic-user",
      });
    });
  });

  it.effect("fails with LoginNotAllowed when the api refuses the login", () => {
    const { binding } = recordingBinding(() =>
      Response.json({ _tag: "LoginNotAllowed", message: "no" }, { status: 403 }),
    );
    return Effect.gen(function* () {
      const error = yield* ApiClient.createMcpToken({ API: binding }, "synthetic-x").pipe(
        Effect.flip,
      );
      assert.instanceOf(error, Errors.LoginNotAllowed);
    });
  });
});

describe("isTokenActive", () => {
  const check = (response: () => Response) =>
    ApiClient.isTokenActive(
      { API: recordingBinding(response).binding },
      Redacted.make("synthetic-grant-token"),
    );

  it.effect("is false only when the api answers 401", () =>
    Effect.gen(function* () {
      assert.isTrue(yield* check(() => Response.json({ kind: "user" })));
      assert.isFalse(
        yield* check(() => Response.json({ _tag: "Unauthorized", message: "x" }, { status: 401 })),
      );
      assert.isTrue(yield* check(() => new Response("boom", { status: 500 })));
    }),
  );
});
