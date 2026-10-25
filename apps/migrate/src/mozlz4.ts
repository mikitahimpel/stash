import { Data, Effect } from "effect";

/**
 * Firefox's `mozlz4` container (`recovery.jsonlz4`, `*.baklz4`): the magic `mozLz40\0`, the
 * decompressed size as a little-endian uint32, then one raw LZ4 block.
 *
 * The LZ4 block format is small and fully specified, so it is decoded here instead of pulling in an
 * lz4 package: the npm options are native addons, frame-format only, or unmaintained, and none is
 * needed for a one-off import that only ever reads.
 */

export class MozLz4Error extends Data.TaggedError("MozLz4Error")<{
  readonly message: string;
}> {}

export const magic: Uint8Array = new TextEncoder().encode("mozLz40\0");

const headerLength = magic.length + 4;

// One LZ4 input byte expands to at most 255 output bytes.
const maxRatio = 255;

const fail = (message: string): never => {
  throw new MozLz4Error({ message });
};

/** Decodes one raw LZ4 block into exactly `size` bytes. */
export const decodeBlock = (src: Uint8Array, size: number): Uint8Array => {
  const out = new Uint8Array(size);
  let ip = 0;
  let op = 0;

  const readByte = (): number => {
    const byte = src[ip++];
    return byte === undefined ? fail("LZ4 block is truncated") : byte;
  };

  const readLength = (base: number): number => {
    let length = base;
    if (base === 15) {
      let byte: number;
      do {
        byte = readByte();
        length += byte;
      } while (byte === 255);
    }
    return length;
  };

  while (ip < src.length) {
    const token = readByte();

    const literals = readLength(token >>> 4);
    if (ip + literals > src.length) fail("LZ4 literals run past the end of the block");
    if (op + literals > size) fail("LZ4 output exceeds the declared size");
    out.set(src.subarray(ip, ip + literals), op);
    ip += literals;
    op += literals;

    // The last sequence carries literals only.
    if (ip === src.length) break;

    const offset = readByte() | (readByte() << 8);
    if (offset === 0 || offset > op) fail("LZ4 match offset is out of range");
    const matchLength = readLength(token & 0x0f) + 4;
    if (op + matchLength > size) fail("LZ4 output exceeds the declared size");
    // Byte by byte: a match may overlap the bytes it is producing.
    for (let i = 0; i < matchLength; i++) {
      out[op] = out[op - offset]!;
      op++;
    }
  }

  if (op !== size) fail(`LZ4 output is ${op} bytes, expected ${size}`);
  return out;
};

/** Decodes a whole `mozlz4` file into its raw bytes. */
export const decode = (bytes: Uint8Array): Effect.Effect<Uint8Array, MozLz4Error> =>
  Effect.try({
    try: () => {
      if (bytes.length < headerLength || magic.some((byte, i) => bytes[i] !== byte)) {
        fail("not a mozlz4 file (missing mozLz40 header)");
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const size = view.getUint32(magic.length, true);
      const block = bytes.subarray(headerLength);
      if (size > block.length * maxRatio) fail("declared size is larger than LZ4 can produce");
      return decodeBlock(block, size);
    },
    catch: (error) =>
      error instanceof MozLz4Error ? error : new MozLz4Error({ message: String(error) }),
  });
