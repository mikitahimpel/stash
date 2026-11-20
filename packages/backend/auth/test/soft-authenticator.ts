// A software WebAuthn authenticator for tests: it makes ES256 passkeys and answers ceremonies the
// way a browser serializes them (`PublicKeyCredential.toJSON()`), with `none` attestation. Keys
// are made fresh in memory; nothing here is a real credential.

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const fromB64url = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "base64url"));

const sha256 = async (bytes: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));

const concat = (...parts: ReadonlyArray<Uint8Array>) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

// The CBOR this needs: maps with integer or text keys, integers, byte and text strings.
type Cbor = number | string | Uint8Array | ReadonlyMap<number | string, Cbor>;
const head = (major: number, value: number): Uint8Array => {
  if (value < 24) return new Uint8Array([(major << 5) | value]);
  if (value < 256) return new Uint8Array([(major << 5) | 24, value]);
  return new Uint8Array([(major << 5) | 25, value >> 8, value & 0xff]);
};
const cbor = (value: Cbor): Uint8Array => {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return concat(head(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  const entries = [...value.entries()];
  return concat(head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)]));
};

// WebCrypto signs ECDSA as `r || s`; WebAuthn wants DER.
const derInteger = (bytes: Uint8Array) => {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  let trimmed = bytes.slice(start);
  if (trimmed[0]! & 0x80) trimmed = concat(new Uint8Array([0]), trimmed);
  return concat(new Uint8Array([0x02, trimmed.length]), trimmed);
};
const toDer = (raw: Uint8Array) => {
  const body = concat(derInteger(raw.slice(0, 32)), derInteger(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
};

const flags = { up: 0x01, uv: 0x04, be: 0x08, bs: 0x10, at: 0x40 };

/** One passkey the authenticator holds. */
export interface Passkey {
  readonly id: string;
  readonly userHandle: string;
  readonly rpId: string;
  readonly keys: CryptoKeyPair;
  counter: number;
}

export interface Options {
  /** Whether passkeys are backed up and sync (iCloud Keychain does; a security key doesn't). */
  readonly synced?: boolean;
  /** Counts signatures (synced passkeys don't, and stay at 0). */
  readonly counts?: boolean;
}

/** An authenticator, with the passkeys it made. */
export const make = (options: Options = {}) => {
  const passkeys: Array<Passkey> = [];
  const synced = options.synced ?? true;

  const clientData = (type: string, challenge: string, origin: string) =>
    new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    passkeys,
    /** Answers `navigator.credentials.create()` for creation options (JSON). */
    create: async (
      creation: Record<string, unknown>,
      origin: string,
    ): Promise<Record<string, unknown>> => {
      const rp = creation["rp"] as { id: string };
      const user = creation["user"] as { id: string };
      const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
      const jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
      const id = crypto.getRandomValues(new Uint8Array(16));
      const coseKey = new Map<number, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, fromB64url(jwk.x!)],
        [-3, fromB64url(jwk.y!)],
      ]);
      const authData = concat(
        await sha256(new TextEncoder().encode(rp.id)),
        new Uint8Array([flags.up | flags.uv | flags.at | (synced ? flags.be | flags.bs : 0)]),
        new Uint8Array(4),
        new Uint8Array(16),
        new Uint8Array([0, id.length]),
        id,
        cbor(coseKey),
      );
      const attestationObject = cbor(
        new Map<string, Cbor>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData],
        ]),
      );
      passkeys.push({ id: b64url(id), userHandle: user.id, rpId: rp.id, keys, counter: 0 });
      return {
        id: b64url(id),
        rawId: b64url(id),
        type: "public-key",
        response: {
          clientDataJSON: b64url(
            clientData("webauthn.create", String(creation["challenge"]), origin),
          ),
          attestationObject: b64url(attestationObject),
          transports: ["internal", "hybrid"],
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
    /** Answers `navigator.credentials.get()` with `passkey` (the first one by default). */
    get: async (
      request: Record<string, unknown>,
      origin: string,
      passkey: Passkey | undefined = passkeys[0],
    ): Promise<Record<string, unknown>> => {
      if (passkey === undefined) throw new Error("the authenticator holds no passkey");
      if (options.counts) passkey.counter++;
      const counter = new Uint8Array(4);
      new DataView(counter.buffer).setUint32(0, passkey.counter);
      const authData = concat(
        await sha256(new TextEncoder().encode(passkey.rpId)),
        new Uint8Array([flags.up | flags.uv | (synced ? flags.be | flags.bs : 0)]),
        counter,
      );
      const data = clientData("webauthn.get", String(request["challenge"]), origin);
      const signed = concat(authData, await sha256(data));
      const raw = new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          passkey.keys.privateKey,
          signed as Uint8Array<ArrayBuffer>,
        ),
      );
      return {
        id: passkey.id,
        rawId: passkey.id,
        type: "public-key",
        response: {
          clientDataJSON: b64url(data),
          authenticatorData: b64url(authData),
          signature: b64url(toDer(raw)),
          userHandle: passkey.userHandle,
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
  };
};
