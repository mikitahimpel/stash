import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Blobs from "../src/blobs.ts";
import * as Testing from "../src/testing.ts";

describe("Blobs (in memory)", () => {
  it.effect("puts, gets and deletes", () =>
    Effect.gen(function* () {
      const blobs = yield* Blobs.Blobs;
      expect(yield* blobs.get("links/1/text")).toEqual(Option.none());
      yield* blobs.put("links/1/text", "Привет, page text", { contentType: "text/plain" });
      const blob = yield* blobs.get("links/1/text");
      expect(Option.map(blob, (b) => b.contentType)).toEqual(
        Option.some(Option.some("text/plain")),
      );
      expect(yield* blobs.getText("links/1/text")).toEqual(Option.some("Привет, page text"));

      yield* blobs.put("links/1/raw", new Uint8Array([1, 2, 3]));
      const raw = Option.getOrThrow(yield* blobs.get("links/1/raw"));
      expect([...raw.bytes]).toEqual([1, 2, 3]);
      expect(raw.contentType).toEqual(Option.none());

      yield* blobs.delete("links/1/text");
      expect(yield* blobs.getText("links/1/text")).toEqual(Option.none());
    }).pipe(Effect.provide(Testing.layerBlobs)),
  );
});

describe("Blobs (live)", () => {
  it.effect("maps R2 objects and failures", () =>
    Effect.gen(function* () {
      const store = new Map<string, { body: string | Uint8Array; contentType?: string }>();
      const blobs = Blobs.make({
        put: async (key, body, options) => {
          store.set(key, {
            body,
            ...(options?.httpMetadata?.contentType === undefined
              ? {}
              : { contentType: options.httpMetadata.contentType }),
          });
        },
        get: async (key) => {
          const entry = store.get(key);
          if (entry === undefined) return null;
          const bytes =
            typeof entry.body === "string" ? new TextEncoder().encode(entry.body) : entry.body;
          return {
            arrayBuffer: async () => bytes.slice().buffer,
            ...(entry.contentType === undefined
              ? {}
              : { httpMetadata: { contentType: entry.contentType } }),
          };
        },
        delete: async (key) => void store.delete(key),
      });
      yield* blobs.put("k", "text", { contentType: "text/plain" });
      expect(yield* blobs.getText("k")).toEqual(Option.some("text"));
      expect(Option.getOrThrow(yield* blobs.get("k")).contentType).toEqual(
        Option.some("text/plain"),
      );
      yield* blobs.delete("k");
      expect(yield* blobs.get("k")).toEqual(Option.none());

      const failing = Blobs.make({
        put: () => Promise.reject(new Error("r2 down")),
        get: () => Promise.reject(new Error("r2 down")),
        delete: () => Promise.reject(new Error("r2 down")),
      });
      const error = yield* Effect.flip(failing.get("k"));
      expect(error).toMatchObject({ _tag: "BlobsError", operation: "get", key: "k" });
    }),
  );
});
