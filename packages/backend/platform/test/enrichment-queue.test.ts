import { describe, expect, it } from "@effect/vitest";
import * as Link from "@stash/contracts-domain/link";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as EnrichmentQueue from "../src/enrichment-queue.ts";
import * as Testing from "../src/testing.ts";

const linkId = Schema.decodeSync(Link.LinkId);

describe("EnrichmentQueue (in memory)", () => {
  it.effect("delivers sent messages to the consumer in order", () =>
    Effect.gen(function* () {
      const queue = yield* EnrichmentQueue.EnrichmentQueue;
      const consumer = yield* Testing.TestEnrichmentQueue;
      yield* queue.send({ linkId: linkId("link-1") });
      yield* queue.sendBatch([{ linkId: linkId("link-2") }, { linkId: linkId("link-3") }]);
      expect(yield* consumer.receive).toEqual({ linkId: "link-1" });
      expect(yield* consumer.drain).toEqual([{ linkId: "link-2" }, { linkId: "link-3" }]);
      expect(yield* consumer.drain).toEqual([]);
    }).pipe(Effect.provide(Testing.layerEnrichmentQueue)),
  );

  it.effect("receive waits for a message", () =>
    Effect.gen(function* () {
      const queue = yield* EnrichmentQueue.EnrichmentQueue;
      const consumer = yield* Testing.TestEnrichmentQueue;
      const fiber = yield* Effect.forkChild(consumer.receive);
      yield* Effect.yieldNow;
      yield* queue.send({ linkId: linkId("link-late") });
      expect(yield* Fiber.join(fiber)).toEqual({ linkId: "link-late" });
    }).pipe(Effect.provide(Testing.layerEnrichmentQueue)),
  );
});

describe("EnrichmentQueue (live)", () => {
  it.effect("sends encoded bodies and maps failures", () =>
    Effect.gen(function* () {
      const sent: Array<unknown> = [];
      const queue = EnrichmentQueue.make({
        send: async (message) => void sent.push(message),
        sendBatch: async (messages) => void sent.push([...messages]),
      });
      yield* queue.send({ linkId: linkId("link-1") });
      yield* queue.sendBatch([{ linkId: linkId("link-2") }]);
      yield* queue.sendBatch([]);
      expect(sent).toEqual([{ linkId: "link-1" }, [{ body: { linkId: "link-2" } }]]);

      const failing = EnrichmentQueue.make({
        send: () => Promise.reject(new Error("queue down")),
        sendBatch: () => Promise.reject(new Error("queue down")),
      });
      const error = yield* Effect.flip(failing.send({ linkId: linkId("link-1") }));
      expect(error._tag).toBe("EnrichmentQueueError");
    }),
  );
});
