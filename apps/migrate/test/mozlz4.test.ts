import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import * as MozLz4 from "../src/mozlz4.ts";
import * as Encode from "./mozlz4-encode.ts";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("decode", () => {
  it.effect("round-trips text with repeats, long literals and long matches", () =>
    Effect.gen(function* () {
      const input = text(
        `${"https://example.com/".repeat(40)}${"a".repeat(600)}${Array.from({ length: 300 }, (_, i) => String.fromCharCode(33 + (i % 90))).join("")}end`,
      );
      const encoded = Encode.encode(input);
      expect(encoded.length).toBeLessThan(input.length);
      expect(yield* MozLz4.decode(encoded)).toEqual(input);
    }),
  );

  it.effect("round-trips an empty payload", () =>
    Effect.gen(function* () {
      expect(yield* MozLz4.decode(Encode.encode(new Uint8Array()))).toEqual(new Uint8Array());
    }),
  );

  it.effect("decodes an overlapping match (run-length)", () =>
    Effect.gen(function* () {
      // Literal "ab", then a match at offset 2 of length 4 + 6, then literals "xyzzy".
      const block = Uint8Array.from([
        0x26, 0x61, 0x62, 0x02, 0x00, 0x50, 0x78, 0x79, 0x7a, 0x7a, 0x79,
      ]);
      const header = new Uint8Array(12);
      header.set(MozLz4.magic);
      new DataView(header.buffer).setUint32(8, 17, true);
      const out = yield* MozLz4.decode(Uint8Array.from([...header, ...block]));
      expect(new TextDecoder().decode(out)).toBe("ababababababxyzzy");
    }),
  );

  it.effect("rejects a missing header", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(MozLz4.decode(text('{"windows":[]}')));
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("rejects a truncated block", () =>
    Effect.gen(function* () {
      const encoded = Encode.encode(text("https://example.com/".repeat(20)));
      const error = yield* Effect.flip(MozLz4.decode(encoded.subarray(0, encoded.length - 3)));
      expect(error._tag).toBe("MozLz4Error");
    }),
  );

  it.effect("rejects a wrong declared size", () =>
    Effect.gen(function* () {
      const encoded = Encode.encode(text("https://example.com/".repeat(20)));
      new DataView(encoded.buffer).setUint32(8, 7, true);
      const error = yield* Effect.flip(MozLz4.decode(encoded));
      expect(error.message).toMatch(/declared size/);
    }),
  );

  it.effect("rejects an out-of-range match offset", () =>
    Effect.gen(function* () {
      const block = Uint8Array.from([0x10, 0x61, 0x09, 0x00, 0x00]);
      const header = new Uint8Array(12);
      header.set(MozLz4.magic);
      new DataView(header.buffer).setUint32(8, 5, true);
      const error = yield* Effect.flip(MozLz4.decode(Uint8Array.from([...header, ...block])));
      expect(error.message).toMatch(/offset/);
    }),
  );
});
