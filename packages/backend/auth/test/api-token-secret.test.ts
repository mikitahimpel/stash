import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as ApiTokenSecret from "../src/api-tokens/api-token-secret.ts";

describe("ApiTokenSecret", () => {
  it.effect("generates distinct prefixed tokens", () =>
    Effect.gen(function* () {
      const a = Redacted.value(yield* ApiTokenSecret.generate);
      const b = Redacted.value(yield* ApiTokenSecret.generate);
      expect(a).toMatch(/^stash_[\w-]{43}$/);
      expect(a).not.toBe(b);
    }),
  );

  it.effect("hashes with SHA-256 as lowercase hex", () =>
    Effect.gen(function* () {
      // The well-known SHA-256 of "abc".
      expect(yield* ApiTokenSecret.hash(Redacted.make("abc"))).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    }),
  );

  it("compares hashes", () => {
    expect(ApiTokenSecret.constantTimeEqual("abcd", "abcd")).toBe(true);
    expect(ApiTokenSecret.constantTimeEqual("abcd", "abce")).toBe(false);
    expect(ApiTokenSecret.constantTimeEqual("abcd", "abc")).toBe(false);
    expect(ApiTokenSecret.constantTimeEqual("", "a")).toBe(false);
  });
});
