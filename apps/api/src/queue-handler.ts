import * as EnrichmentQueue from "@stash/backend-platform/enrichment-queue";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

/** Handles one enrichment message. The enrichment feature provides the real layer. */
export class EnrichmentConsumer extends Context.Service<
  EnrichmentConsumer,
  {
    readonly consume: (message: EnrichmentQueue.EnrichmentMessage) => Effect.Effect<void, unknown>;
  }
>()("@stash/api/EnrichmentConsumer") {}

/** Logs each message and does nothing else, until enrichment lands. */
export const layerNoop: Layer.Layer<EnrichmentConsumer> = Layer.succeed(EnrichmentConsumer)({
  consume: (message) => Effect.log(`enrichment: received ${message.linkId}`),
});

/** The part of a queue message this handler uses. `Message` satisfies it. */
export interface QueueMessage {
  readonly id: string;
  readonly body: unknown;
  ack(): void;
  retry(): void;
}

const decode = Schema.decodeUnknownEffect(EnrichmentQueue.EnrichmentMessage);

/** Acks each message the consumer handled. Malformed messages and failures are retried. */
export const handleBatch = (
  messages: ReadonlyArray<QueueMessage>,
): Effect.Effect<void, never, EnrichmentConsumer> =>
  Effect.gen(function* () {
    const consumer = yield* EnrichmentConsumer;
    yield* Effect.forEach(
      messages,
      (message) =>
        decode(message.body).pipe(
          Effect.flatMap(consumer.consume),
          Effect.matchCauseEffect({
            onSuccess: () => Effect.sync(() => message.ack()),
            onFailure: (cause) =>
              Effect.logError(`enrichment: message ${message.id} failed`, cause).pipe(
                Effect.andThen(Effect.sync(() => message.retry())),
              ),
          }),
        ),
      { discard: true },
    );
  });
