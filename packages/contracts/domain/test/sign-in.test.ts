import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as SignIn from "../src/sign-in.ts";

describe("sign-in", () => {
  it("accepts a base64url credential id and rejects anything else", () => {
    const decode = Schema.decodeUnknownSync(SignIn.PasskeyId);
    expect(decode("AAECAwQFBgcICQoLDA0ODw")).toBe("AAECAwQFBgcICQoLDA0ODw");
    expect(() => decode("not base64url!")).toThrow();
    expect(() => decode("short")).toThrow();
  });

  it("round-trips a passkey and a linked account", () => {
    const passkey = {
      id: "AAECAwQFBgcICQoLDA0ODw",
      name: "iCloud Keychain",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: null,
      synced: true,
    };
    const codec = SignIn.Passkey;
    expect(Schema.encodeSync(codec)(Schema.decodeUnknownSync(codec)(passkey))).toEqual(passkey);
    const account = {
      id: "google:1001",
      provider: "google",
      label: "person@example.com",
      linkedAt: "2026-01-01T00:00:00.000Z",
      fixed: false,
    };
    expect(
      Schema.encodeSync(SignIn.LinkedAccount)(
        Schema.decodeUnknownSync(SignIn.LinkedAccount)(account),
      ),
    ).toEqual(account);
    expect(() =>
      Schema.decodeUnknownSync(SignIn.LinkedAccount)({ ...account, provider: "passkey" }),
    ).toThrow();
  });

  it("counts every way to sign in", () => {
    expect(SignIn.count({ passkeys: [], accounts: [] })).toBe(0);
    expect(SignIn.count({ passkeys: [{} as never], accounts: [{} as never, {} as never] })).toBe(3);
  });

  it("takes a credential as the browser serializes it", () => {
    const credential = {
      id: "AAECAwQFBgcICQoLDA0ODw",
      rawId: "AAECAwQFBgcICQoLDA0ODw",
      type: "public-key",
      response: { clientDataJSON: "e30", authenticatorData: "AA", signature: "AA" },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
    expect(Schema.decodeUnknownSync(SignIn.PasskeyCredential)(credential)).toEqual(credential);
    expect(() =>
      Schema.decodeUnknownSync(SignIn.PasskeyCredential)({ ...credential, type: "password" }),
    ).toThrow();
  });
});
