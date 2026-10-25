import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Redacted from "effect/Redacted";
import * as ExtensionConfig from "../src/extension-config.ts";
import * as StashApiClient from "../src/stash-api-client.ts";
import * as Testing from "../src/testing.ts";

// Synthetic placeholders, not real tokens.
const config = { apiBaseUrl: "https://api.example.com", deviceToken: "synthetic-token-1" };

const recording = () => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const handler = (request: HttpClientRequest.HttpClientRequest) =>
    Effect.sync(() => {
      requests.push(request);
      return Response.json({ kind: "device", deviceId: "device-1" });
    });
  return { requests, handler };
};

describe("StashApiClient", () => {
  it.effect("calls the configured API with the device token", () => {
    const { requests, handler } = recording();
    return Effect.gen(function* () {
      const client = yield* StashApiClient.StashApiClient;
      const principal = yield* client.auth.me();
      expect(principal).toEqual({ kind: "device", deviceId: "device-1" });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe("GET");
      expect(requests[0]?.url).toBe("https://api.example.com/auth/me");
      expect(requests[0]?.headers["authorization"]).toBe("Bearer synthetic-token-1");
    }).pipe(Effect.provide(Testing.make({ config, handler })));
  });

  it.effect("picks up a new config without being rebuilt", () => {
    const { requests, handler } = recording();
    return Effect.gen(function* () {
      const client = yield* StashApiClient.StashApiClient;
      yield* client.auth.me();
      yield* (yield* ExtensionConfig.ExtensionConfig).set({
        apiBaseUrl: "https://other.example.com/base",
        deviceToken: Redacted.make("synthetic-token-2"),
      });
      yield* client.auth.me();
      expect(requests.map((request) => request.url)).toEqual([
        "https://api.example.com/auth/me",
        "https://other.example.com/base/auth/me",
      ]);
      expect(requests[1]?.headers["authorization"]).toBe("Bearer synthetic-token-2");
    }).pipe(Effect.provide(Testing.make({ config, handler })));
  });

  it.effect("fails with ConfigError and sends nothing before a token is saved", () => {
    const { requests, handler } = recording();
    return Effect.gen(function* () {
      const client = yield* StashApiClient.StashApiClient;
      const error = yield* Effect.flip(client.auth.me());
      expect(error).toMatchObject({ _tag: "ConfigError", reason: "Missing" });
      expect(requests).toEqual([]);
    }).pipe(Effect.provide(Testing.make({ handler })));
  });

  it.effect("decodes declared API errors", () =>
    Effect.gen(function* () {
      const client = yield* StashApiClient.StashApiClient;
      const error = yield* Effect.flip(client.auth.me());
      expect(error._tag).toBe("Unauthorized");
    }).pipe(
      Effect.provide(
        Testing.make({
          config,
          handler: () =>
            Effect.succeed(
              Response.json({ _tag: "Unauthorized", message: "Invalid token" }, { status: 401 }),
            ),
        }),
      ),
    ),
  );
});
