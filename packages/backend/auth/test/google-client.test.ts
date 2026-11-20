import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/backend-platform/testing";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as GoogleClient from "../src/google/google-client.ts";

// The cache of Google's signing keys: kept for `Cache-Control: max-age`, at most an hour, so a key
// Google retired stops being trusted. Keys and tokens are made for the test.

const generate = async () =>
  (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
const oldKey = await generate();
const newKey = await generate();
const jwk = async (keys: CryptoKeyPair, kid: string) => ({
  ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
  kid,
});
const jwks = { old: await jwk(oldKey, "old"), new: await jwk(newKey, "new") };

const b64 = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");
const token = async (keys: CryptoKeyPair, kid: string) => {
  const head = b64(JSON.stringify({ alg: "RS256", kid }));
  const body = b64(
    JSON.stringify({
      iss: "https://idp.example.com",
      aud: "synthetic-google-client-id",
      sub: "synthetic-sub",
      iat: 0,
      exp: 10 * 24 * 3600,
      nonce: "n",
    }),
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return Redacted.make(`${head}.${body}.${b64(new Uint8Array(signature))}`);
};
const signedOld = await token(oldKey, "old");
const signedNew = await token(newKey, "new");

/** A fake JWKS endpoint: what it publishes now, and how often it was asked. */
const makeIdp = (cacheControl: string | undefined) => {
  const state = { keys: [jwks.old] as Array<unknown>, fetches: 0 };
  const layer = Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) => {
      state.fetches++;
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json(
            { keys: state.keys },
            { headers: cacheControl === undefined ? {} : { "cache-control": cacheControl } },
          ),
        ),
      );
    }),
  );
  return {
    state,
    layer: GoogleClient.layer.pipe(Layer.provide(Layer.merge(layer, Testing.layerGoogleConfig()))),
  };
};

const verify = (idToken: Redacted.Redacted<string>) =>
  GoogleClient.GoogleClient.use((client) => client.verifyIdToken(idToken, "n"));

describe("keysAgeMillis", () => {
  it("follows max-age, at most an hour, and keeps nothing for no-store", () => {
    expect(GoogleClient.keysAgeMillis("public, max-age=21600, must-revalidate")).toBe(3_600_000);
    expect(GoogleClient.keysAgeMillis("public, max-age=120")).toBe(120_000);
    expect(GoogleClient.keysAgeMillis(undefined)).toBe(3_600_000);
    expect(GoogleClient.keysAgeMillis("no-store")).toBe(0);
  });
});

describe("Google's signing keys", () => {
  it.effect("are kept for max-age, then asked for again, and a retired key stops working", () => {
    const idp = makeIdp("public, max-age=120");
    return Effect.gen(function* () {
      expect((yield* verify(signedOld)).sub).toBe("synthetic-sub");
      yield* TestClock.adjust("100 seconds");
      yield* verify(signedOld);
      expect(idp.state.fetches).toBe(1);

      // Google rotated: the old key is gone from its JWKS.
      idp.state.keys = [jwks.new];
      yield* TestClock.adjust("30 seconds");
      const retired = yield* Effect.flip(verify(signedOld));
      expect(retired.reason).toBe("ID token signed with an unknown key");
      expect(idp.state.fetches).toBe(2);
      expect((yield* verify(signedNew)).sub).toBe("synthetic-sub");
    }).pipe(Effect.provide(idp.layer));
  });

  it.effect("are never kept longer than an hour, whatever Google's cache says", () => {
    const idp = makeIdp("public, max-age=86400");
    return Effect.gen(function* () {
      yield* verify(signedOld);
      idp.state.keys = [jwks.new];
      yield* TestClock.adjust("59 minutes");
      yield* verify(signedOld);
      expect(idp.state.fetches).toBe(1);
      yield* TestClock.adjust("2 minutes");
      expect((yield* Effect.flip(verify(signedOld))).reason).toBe(
        "ID token signed with an unknown key",
      );
      expect(idp.state.fetches).toBe(2);
    }).pipe(Effect.provide(idp.layer));
  });
});
