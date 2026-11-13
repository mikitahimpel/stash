import { describe, expect, it } from "@effect/vitest";
import * as ExtensionConfig from "@stash/ext-platform/extension-config";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as PairExtension from "../entrypoints/options/pair-extension.ts";

// A fake api that answers `pairings.claim` with 404 until `approve()`, then once with a synthetic
// token (not a real one), then 404 again.
const fakeApi = () => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  let approved = false;
  const handler = (request: HttpClientRequest.HttpClientRequest) =>
    Effect.sync(() => {
      requests.push(request);
      if (!approved) {
        return Response.json(
          { _tag: "NotFound", resource: "pairing", id: "code" },
          { status: 404 },
        );
      }
      approved = false;
      return Response.json(
        {
          id: "token-1",
          deviceId: "device-zen",
          name: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          revokedAt: null,
          lastUsedAt: null,
          token: "stash_synthetic-paired-token",
        },
        { status: 201 },
      );
    });
  return {
    requests,
    handler,
    approve: () => {
      approved = true;
    },
  };
};

describe("options page: pair with the web app", () => {
  it.each([
    ["stash.example.com", "https://stash.example.com"],
    ["https://stash.example.com/connect", "https://stash.example.com"],
    ["http://localhost:8791/", "http://localhost:8791"],
    ["  ", undefined],
    ["ftp://stash.example.com", undefined],
  ])("reads the web origin from %j", (input, origin) => {
    expect(PairExtension.webOrigin(input)).toBe(origin);
  });

  it("prefills the web origin from a saved api URL", () => {
    expect(PairExtension.webOriginOfApi("https://stash.example.com/api")).toBe(
      "https://stash.example.com",
    );
    expect(PairExtension.webOriginOfApi("")).toBe("");
  });

  it.effect("opens the approval page, polls the claim and saves the token", () => {
    const api = fakeApi();
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(PairExtension.connect("stash.example.com"));
      yield* TestClock.adjust("1 second");

      const opened = (yield* (yield* Testing.TestTabs).all).at(-1)?.url ?? "";
      expect(opened).toMatch(/^https:\/\/stash\.example\.com\/connect\/extension\?code=[\w-]{43}$/);
      const code = new URL(opened).searchParams.get("code");

      yield* TestClock.adjust("4 seconds");
      api.approve();
      yield* TestClock.adjust("2 seconds");
      expect(yield* Fiber.join(fiber)).toEqual({
        _tag: "Connected",
        webOrigin: "https://stash.example.com",
      });

      expect(api.requests.length).toBeGreaterThanOrEqual(3);
      for (const request of api.requests) {
        expect([request.method, request.url]).toEqual([
          "POST",
          "https://stash.example.com/api/pairings/claim",
        ]);
        expect(request.headers["authorization"]).toBeUndefined();
      }
      const body = api.requests[0]?.body;
      expect(
        body?._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(body.body)) : null,
      ).toEqual({ code });

      const config = yield* Effect.flatMap(ExtensionConfig.ExtensionConfig, (it) => it.get);
      expect(config.apiBaseUrl.toString()).toBe("https://stash.example.com/api");
      expect(Redacted.value(config.deviceToken)).toBe("stash_synthetic-paired-token");
    }).pipe(Effect.provide(Testing.make({ handler: api.handler })));
  });

  it.effect("gives up when nobody approves in time", () => {
    const api = fakeApi();
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(PairExtension.connect("https://stash.example.com"));
      yield* TestClock.adjust(PairExtension.waitAtMost);
      expect(yield* Fiber.join(fiber)).toEqual({
        _tag: "Failed",
        message: "Not approved in time. Click Connect to try again.",
      });
    }).pipe(Effect.provide(Testing.make({ handler: api.handler })));
  });

  it.effect("rejects an address that is not http(s)", () =>
    Effect.gen(function* () {
      const result = yield* PairExtension.connect("");
      expect(result._tag).toBe("Failed");
      expect((yield* (yield* Testing.TestTabs).all).length).toBe(0);
    }).pipe(Effect.provide(Testing.make())),
  );
});
