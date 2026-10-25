import * as MozLz4 from "../src/mozlz4.ts";

/**
 * Test-only LZ4 block encoder: a greedy matcher that emits real back-references, so the fixtures
 * exercise the decoder's match path and not just literals. Not tuned for ratio or speed.
 */

const minMatch = 4;
// The LZ4 format ends every block with at least 5 literals, and the last match starts at least
// 12 bytes before the end.
const lastLiterals = 5;
const matchLimit = 12;

const pushLength = (out: Array<number>, length: number): void => {
  let rest = length - 15;
  while (rest >= 255) {
    out.push(255);
    rest -= 255;
  }
  out.push(rest);
};

const pushSequence = (
  out: Array<number>,
  literals: Uint8Array,
  match: { readonly offset: number; readonly length: number } | null,
): void => {
  const matchCode = match === null ? 0 : match.length - minMatch;
  out.push((Math.min(literals.length, 15) << 4) | Math.min(matchCode, 15));
  if (literals.length >= 15) pushLength(out, literals.length);
  out.push(...literals);
  if (match === null) return;
  out.push(match.offset & 0xff, match.offset >>> 8);
  if (matchCode >= 15) pushLength(out, matchCode);
};

export const encodeBlock = (src: Uint8Array): Uint8Array => {
  const out: Array<number> = [];
  const seen = new Map<number, number>();
  let anchor = 0;
  let i = 0;
  while (i + matchLimit <= src.length) {
    const key = (src[i]! | (src[i + 1]! << 8) | (src[i + 2]! << 16) | (src[i + 3]! << 24)) >>> 0;
    const candidate = seen.get(key);
    seen.set(key, i);
    if (candidate !== undefined && i - candidate <= 0xffff) {
      let length = minMatch;
      while (
        i + length < src.length - lastLiterals &&
        src[candidate + length] === src[i + length]
      ) {
        length++;
      }
      pushSequence(out, src.subarray(anchor, i), { offset: i - candidate, length });
      i += length;
      anchor = i;
    } else {
      i++;
    }
  }
  pushSequence(out, src.subarray(anchor), null);
  return Uint8Array.from(out);
};

/** Wraps bytes in a `mozlz4` container, as Firefox writes `recovery.jsonlz4`. */
export const encode = (bytes: Uint8Array): Uint8Array => {
  const block = encodeBlock(bytes);
  const out = new Uint8Array(MozLz4.magic.length + 4 + block.length);
  out.set(MozLz4.magic, 0);
  new DataView(out.buffer).setUint32(MozLz4.magic.length, bytes.length, true);
  out.set(block, MozLz4.magic.length + 4);
  return out;
};

export const encodeJson = (value: unknown): Uint8Array =>
  encode(new TextEncoder().encode(JSON.stringify(value)));
