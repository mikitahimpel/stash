import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Pairing from "../src/pairing.ts";

describe("PairingCode", () => {
  it("accepts 32 to 128 base64url characters", () => {
    expect(Schema.is(Pairing.PairingCode)("a".repeat(32))).toBe(true);
    expect(Schema.is(Pairing.PairingCode)("Ab0_-".repeat(9))).toBe(true);
    expect(Schema.is(Pairing.PairingCode)("a".repeat(128))).toBe(true);
  });

  it.each([
    ["too short", "a".repeat(31)],
    ["too long", "a".repeat(129)],
    ["not base64url", `${"a".repeat(31)}+`],
    ["with whitespace", `${"a".repeat(31)} `],
  ])("rejects a code %s", (_, code) => {
    expect(Schema.is(Pairing.PairingCode)(code)).toBe(false);
  });
});
