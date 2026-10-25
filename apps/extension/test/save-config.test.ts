import { describe, expect, it } from "@effect/vitest";
import * as ExtensionConfig from "@stash/ext-platform/extension-config";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Redacted from "effect/Redacted";
import * as SaveConfig from "../entrypoints/options/save-config.ts";

// Synthetic placeholders, not real tokens.
const saved = { apiBaseUrl: "https://old.example.com", deviceToken: "synthetic-old" };
const input = { apiBaseUrl: "https://api.example.com", deviceToken: "synthetic-new" };

const api = (status: number) => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const handler = (request: HttpClientRequest.HttpClientRequest) =>
    Effect.sync(() => {
      requests.push(request);
      return status === 200
        ? Response.json({ kind: "device", deviceId: "device-1" })
        : Response.json({ _tag: "Unauthorized", message: "Invalid token" }, { status });
    });
  return { requests, handler };
};

const stored = Effect.flatMap(ExtensionConfig.ExtensionConfig, (config) => config.get).pipe(
  Effect.map((config) => ({
    apiBaseUrl: config.apiBaseUrl.toString(),
    deviceToken: Redacted.value(config.deviceToken),
  })),
);

describe("options page: save config", () => {
  it.effect("saves a config the API accepts and checks it with GET /auth/me", () => {
    const { requests, handler } = api(200);
    return Effect.gen(function* () {
      const result = yield* SaveConfig.submit(input);
      expect(result).toEqual({
        _tag: "Saved",
        principal: { kind: "device", deviceId: "device-1" },
      });
      expect(requests.map((request) => [request.method, request.url])).toEqual([
        ["GET", "https://api.example.com/auth/me"],
      ]);
      expect(requests[0]?.headers["authorization"]).toBe("Bearer synthetic-new");
      expect(yield* stored).toEqual({
        apiBaseUrl: "https://api.example.com/",
        deviceToken: "synthetic-new",
      });
      expect(yield* SaveConfig.load).toBe("https://api.example.com/");
    }).pipe(Effect.provide(Testing.make({ handler })));
  });

  it.effect("restores the previous config when the API rejects the token", () => {
    const { handler } = api(401);
    return Effect.gen(function* () {
      const result = yield* SaveConfig.submit(input);
      expect(result).toEqual({ _tag: "Failed", message: "The API rejected this device token." });
      expect(yield* stored).toEqual({
        apiBaseUrl: "https://old.example.com/",
        deviceToken: "synthetic-old",
      });
    }).pipe(Effect.provide(Testing.make({ config: saved, handler })));
  });

  it.effect("clears the config when there was none and the API is unreachable", () => {
    const { handler } = api(500);
    return Effect.gen(function* () {
      const result = yield* SaveConfig.submit(input);
      expect(result).toEqual({ _tag: "Failed", message: "Could not reach the API at this URL." });
      const error = yield* Effect.flip(stored);
      expect(error).toMatchObject({ _tag: "ConfigError", reason: "Missing" });
      expect(yield* SaveConfig.load).toBe("");
    }).pipe(Effect.provide(Testing.make({ handler })));
  });

  it.effect("rejects an invalid URL without calling the API", () => {
    const { requests, handler } = api(200);
    return Effect.gen(function* () {
      const result = yield* SaveConfig.submit({ ...input, apiBaseUrl: "ftp://example.com" });
      expect(result).toEqual({
        _tag: "Failed",
        message: "Enter an http(s) API URL and a device token.",
      });
      expect(requests).toEqual([]);
      expect(yield* stored).toEqual({
        apiBaseUrl: "https://old.example.com/",
        deviceToken: "synthetic-old",
      });
    }).pipe(Effect.provide(Testing.make({ config: saved, handler })));
  });
});
