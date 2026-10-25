import { assert, describe, it } from "@effect/vitest";
import * as Errors from "@stash/contracts-domain/errors";
import { Effect } from "effect";
import * as ApiClient from "../src/api-client.ts";

// Synthetic placeholder, not a real token.
const token = "synthetic-live-token";

const digest = {
  periodStart: "2026-01-01T00:00:00.000Z",
  periodEnd: "2026-01-08T00:00:00.000Z",
  generatedAt: "2026-01-08T00:00:00.000Z",
  totals: { saved: 3, seen: 2, done: 1, archived: 0 },
  topTags: [],
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
    }).pipe(Effect.provide(ApiClient.layer({ API: binding, API_TOKEN: token })));
  });

  it.effect("decodes api errors into domain errors", () => {
    const { binding } = recordingBinding(() =>
      Response.json({ _tag: "Unauthorized", message: "Invalid token" }, { status: 401 }),
    );
    return Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;
      const error = yield* client.links.list({ query: {} }).pipe(Effect.flip);
      assert.instanceOf(error, Errors.Unauthorized);
    }).pipe(Effect.provide(ApiClient.layer({ API: binding, API_TOKEN: token })));
  });
});
