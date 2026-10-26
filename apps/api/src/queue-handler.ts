import * as EnrichLink from "@stash/backend-enrichment/enrich-link";
import * as EnrichmentQueue from "@stash/backend-platform/enrichment-queue";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

/** Handles one enrichment message. */
export class EnrichmentConsumer extends Context.Service<
  EnrichmentConsumer,
  {
    readonly consume: (message: EnrichmentQueue.EnrichmentMessage) => Effect.Effect<void, unknown>;
  }
>()("@stash/api/EnrichmentConsumer") {}

const received = (message: EnrichmentQueue.EnrichmentMessage) =>
  Effect.log(`enrichment: received ${message.linkId}`);

/** Logs each message and does nothing else. */
export const layerNoop: Layer.Layer<EnrichmentConsumer> = Layer.succeed(EnrichmentConsumer)({
  consume: received,
});

/**
 * Runs the enrichment pipeline for each message. Permanent failures are marked on the link and
 * succeed, so only transient failures reach `handleBatch` and are retried.
 */
export const layer: Layer.Layer<EnrichmentConsumer, never, EnrichLink.Requirements> = Layer.effect(
  EnrichmentConsumer,
)(
  Effect.gen(function* () {
    const context = yield* Effect.context<EnrichLink.Requirements>();
    return {
      consume: (message) =>
        received(message).pipe(
          Effect.andThen(EnrichLink.enrichLink(message.linkId)),
          Effect.tap((outcome) =>
            Effect.log(`enrichment: ${message.linkId} ${outcome._tag.toLowerCase()}`),
          ),
          Effect.provideContext(context),
        ),
    };
  }),
);

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
