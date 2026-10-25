import * as Link from "@stash/contracts-domain/link";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

/** Asks the consumer to enrich one saved link. */
export const EnrichmentMessage = Schema.Struct({ linkId: Link.LinkId });
export type EnrichmentMessage = typeof EnrichmentMessage.Type;

export class EnrichmentQueueError extends Data.TaggedError("EnrichmentQueueError")<{
  readonly cause: unknown;
}> {}

/** The part of the Queue producer binding this package uses. `Queue` satisfies it. */
export interface QueueBinding {
  send(message: typeof EnrichmentMessage.Encoded): Promise<unknown>;
  sendBatch(messages: Iterable<{ body: typeof EnrichmentMessage.Encoded }>): Promise<unknown>;
}

/** The producer side of the enrichment queue. */
export class EnrichmentQueue extends Context.Service<
  EnrichmentQueue,
  {
    readonly send: (message: EnrichmentMessage) => Effect.Effect<void, EnrichmentQueueError>;
    readonly sendBatch: (
      messages: ReadonlyArray<EnrichmentMessage>,
    ) => Effect.Effect<void, EnrichmentQueueError>;
  }
>()("@stash/backend-platform/EnrichmentQueue") {}

const encode = Schema.encodeSync(EnrichmentMessage);

/** Wraps a Queue producer binding. */
export const make = (queue: QueueBinding): EnrichmentQueue["Service"] => {
  const call = (f: () => Promise<unknown>) =>
    Effect.tryPromise({ try: f, catch: (cause) => new EnrichmentQueueError({ cause }) }).pipe(
      Effect.asVoid,
    );
  return {
    send: (message) => call(() => queue.send(encode(message))),
    sendBatch: (messages) =>
      messages.length === 0
        ? Effect.void
        : call(() => queue.sendBatch(messages.map((message) => ({ body: encode(message) })))),
  };
};

export const layer = (queue: QueueBinding): Layer.Layer<EnrichmentQueue> =>
  Layer.succeed(EnrichmentQueue)(make(queue));
