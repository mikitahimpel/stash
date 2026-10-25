import { describe, expect, it } from "@effect/vitest";
import { Redacted, Schema } from "effect";
import * as ApiToken from "../src/api-token.ts";

const info = {
  id: "token-1",
  deviceId: "device-1",
  createdAt: "2026-01-02T03:04:05.000Z",
  revokedAt: null,
};

// Synthetic placeholder, not a real token.
const plaintext = "synthetic-test-token";

describe("ApiTokenInfo", () => {
  it("round-trips", () => {
    const decoded = Schema.decodeUnknownSync(ApiToken.ApiTokenInfo)(info);
    expect(Schema.encodeSync(ApiToken.ApiTokenInfo)(decoded)).toEqual(info);
  });

  it("has no hash or secret field", () => {
    expect(Object.keys(ApiToken.ApiTokenInfo.fields).sort()).toEqual([
      "createdAt",
      "deviceId",
      "id",
      "revokedAt",
    ]);
  });

  it("rejects a missing device", () => {
    const { deviceId: _, ...rest } = info;
    expect(() => Schema.decodeUnknownSync(ApiToken.ApiTokenInfo)(rest)).toThrow();
  });
});

describe("CreatedApiToken", () => {
  it("decodes the plaintext into a Redacted and encodes it back", () => {
    const input = { ...info, token: plaintext };
    const decoded = Schema.decodeUnknownSync(ApiToken.CreatedApiToken)(input);
    expect(Redacted.isRedacted(decoded.token)).toBe(true);
    expect(String(decoded.token)).not.toContain(plaintext);
    expect(Redacted.value(decoded.token)).toBe(plaintext);
    expect(Schema.encodeSync(ApiToken.CreatedApiToken)(decoded)).toEqual(input);
  });

  it("rejects an empty or missing token", () => {
    expect(() =>
      Schema.decodeUnknownSync(ApiToken.CreatedApiToken)({ ...info, token: "" }),
    ).toThrow();
    expect(() => Schema.decodeUnknownSync(ApiToken.CreatedApiToken)(info)).toThrow();
  });
});
