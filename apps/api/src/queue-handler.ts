import * as ServiceContext from "@stash/backend-platform/service-context";
import * as BackfillMetadata from "@stash/backend-enrichment/backfill-metadata";
import * as EnrichLink from "@stash/backend-enrichment/enrich-link";
import * as EnrichmentRepo from "@stash/backend-enrichment/enrichment-repo";
import * as EnrichmentQueue from "@stash/backend-platform/enrichment-queue";
import * as Security from "@stash/contracts-api/security";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** Handles one enrichment message. */
export class EnrichmentConsumer extends Context.Service<
  EnrichmentConsumer,
  {
    readonly consume: (message: EnrichmentQueue.EnrichmentMessage) => Effect.Effect<void, unknown>;
  }
>()("@stash/api/EnrichmentConsumer") {}

const received = (message: EnrichmentQueue.EnrichmentMessage) =>
  Effect.log(
    `enrichment: received ${message.linkId}${message.task === undefined ? "" : ` (${message.task})`}`,
  );

/** Logs each message and does nothing else. */
export const layerNoop: Layer.Layer<EnrichmentConsumer> = Layer.succeed(EnrichmentConsumer)({
  consume: received,
});

const run = (
  message: EnrichmentQueue.EnrichmentMessage,
): Effect.Effect<{ readonly _tag: string }, unknown, Requirements> =>
  Effect.gen(function* () {
    // A message names only a link. Whose it is comes from the database, and the rest runs as
    // that user: their quota, their vector metadata, their stream.
    const repo = yield* EnrichmentRepo.EnrichmentRepo;
    const owner = yield* repo.ownerOf(message.linkId);
    if (Option.isNone(owner)) return { _tag: "Missing" };
    const task: Effect.Effect<{ readonly _tag: string }, unknown, EnrichLink.Requirements> =
      message.task === "metadata"
        ? BackfillMetadata.backfillMetadata(message.linkId)
        : EnrichLink.enrichLink(message.linkId);
    return yield* Effect.provideService(task, Security.CurrentUser, owner.value);
  });

/** What the consumer needs: everything the pipeline does, except the user, which it finds. */
export type Requirements = Exclude<EnrichLink.Requirements, Security.CurrentUser>;

/**
 * Runs the enrichment pipeline for each message, or only the metadata backfill for a message with
 * `task: "metadata"`, as the user the link belongs to. A link over its user's daily AI quota is
 * `deferred`: acked and left pending for the hourly requeue. Permanent failures are marked on the link and succeed, so only transient
 * failures reach `handleBatch` and are retried.
 */
export const layer: Layer.Layer<EnrichmentConsumer, never, Requirements> = Layer.effect(
  EnrichmentConsumer,
)(
  Effect.gen(function* () {
    const context = yield* ServiceContext.capture<Requirements>();
    return {
      consume: (message) =>
        received(message).pipe(
          Effect.andThen(run(message)),
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
