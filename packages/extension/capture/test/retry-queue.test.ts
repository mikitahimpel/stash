import { describe, expect, it } from "@effect/vitest";
import type * as Link from "@stash/contracts-domain/link";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import * as RetryQueue from "../src/retry-queue.ts";

const input = (path: string, title?: string): Link.SaveLinkInput =>
  (title === undefined
    ? { url: `https://example.com/${path}` }
    : { url: `https://example.com/${path}`, title }) as Link.SaveLinkInput;

describe("retry queue", () => {
  it.effect("keeps one entry per URL, the latest last", () =>
    Effect.gen(function* () {
      const queue = yield* RetryQueue.make;
      yield* queue.add(input("a"));
      yield* queue.add(input("b"));
      yield* queue.add(input("a", "A again"));
      expect(yield* queue.items).toEqual([input("b"), input("a", "A again")]);
    }).pipe(Effect.provide(Testing.layer)),
  );

  it.effect(`drops the oldest links beyond ${RetryQueue.maxSize}`, () =>
    Effect.gen(function* () {
      const queue = yield* RetryQueue.make;
      yield* queue.add(input("newest"));
      const items = yield* queue.items;
      expect(items).toHaveLength(RetryQueue.maxSize);
      expect(items[0]).toEqual(input("1"));
      expect(items.at(-1)).toEqual(input("newest"));
    }).pipe(
      Effect.provide(
        Testing.make({
          storage: {
            [RetryQueue.storageKey]: Array.from({ length: RetryQueue.maxSize }, (_, i) =>
              input(String(i)),
            ),
          },
        }),
      ),
    ),
  );

  it.effect("treats a stored value that doesn't decode as empty", () =>
    Effect.gen(function* () {
      const queue = yield* RetryQueue.make;
      expect(yield* queue.items).toEqual([]);
      yield* queue.add(input("a"));
      expect(yield* queue.items).toEqual([input("a")]);
    }).pipe(
      Effect.provide(Testing.make({ storage: { [RetryQueue.storageKey]: [{ url: "about:x" }] } })),
    ),
  );
});
