import * as LinkEvent from "@stash/contracts-domain/link-event";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

/** An event a write publishes. `stream.ready` is the stream's own. */
export type Published = LinkEvent.LinkUpdated | LinkEvent.LinkDeleted;

/**
 * The live stream of link changes (`GET /events`), from the side that writes. Publishing is fire
 * and forget: it never fails and never takes long, so a write that publishes cannot fail or hang
 * because of it. A lost event only delays a client, which catches up by itself.
 */
export class LinkEvents extends Context.Service<
  LinkEvents,
  {
    /** Sends the event to every open stream of the user, and to nobody else. */
    readonly publish: (userId: string, event: Published) => Effect.Effect<void>;
    /** Sends several events in one call, in order: the links of one batch save. */
    readonly publishAll: (userId: string, events: ReadonlyArray<Published>) => Effect.Effect<void>;
    /**
     * Closes every open stream of the user and clears their object: for a user who is removed.
     * Like publishing, it never fails.
     */
    readonly close: (userId: string) => Effect.Effect<void>;
  }
>()("@stash/backend-platform/LinkEvents") {}

/**
 * The path of the object that takes events to broadcast: one JSON text per line of the body (the
 * JSON of an event has no line break in it). Any other path opens a stream.
 */
export const publishPath = "/publish";

/** The path of the object that closes its streams and deletes its state. */
export const closePath = "/close";

/** How long a publish may take before the write goes on without it. */
export const publishTimeoutMillis = 2000;

/** The part of a Durable Object stub this package uses. `DurableObjectStub` satisfies it. */
export interface Stub {
  fetch(input: string, init: { method: string; body?: string }): Promise<{ status: number }>;
}

/** The part of the namespace binding this package uses. `DurableObjectNamespace` satisfies it. */
export interface Namespace<S = Stub> {
  idFromName(name: string): unknown;
  get(id: never): S;
}

/**
 * The object that holds one user's streams, named by the user's id. A user's events go to their
 * own object and nowhere else, so no stream can carry another user's links.
 */
export const stub = <S>(namespace: Namespace<S>, userId: string): S =>
  namespace.get(namespace.idFromName(objectName(userId)) as never);

/** The name of a user's object. */
export const objectName = (userId: string): string => `user:${userId}`;

const encode = Schema.encodeSync(LinkEvent.LinkEventFromJson);

/** Publishes to each user's own object. */
export const make = (namespace: Namespace): LinkEvents["Service"] => {
  const publishAll = (userId: string, events: ReadonlyArray<Published>): Effect.Effect<void> =>
    events.length === 0
      ? Effect.void
      : Effect.tryPromise(() =>
          stub(namespace, userId).fetch(`https://link-events${publishPath}`, {
            method: "POST",
            body: events.map((event) => encode(event)).join("\n"),
          }),
        ).pipe(
          Effect.timeout(publishTimeoutMillis),
          Effect.asVoid,
          Effect.catchCause((cause) =>
            Effect.logWarning(
              `link events: ${events.map((event) => event.type).join(", ")} not published`,
              cause,
            ),
          ),
        );
  return {
    publish: (userId, event) => publishAll(userId, [event]),
    publishAll,
    close: (userId) =>
      Effect.tryPromise(() =>
        stub(namespace, userId).fetch(`https://link-events${closePath}`, { method: "POST" }),
      ).pipe(
        Effect.timeout(publishTimeoutMillis),
        Effect.asVoid,
        Effect.catchCause((cause) => Effect.logWarning("link events: streams not closed", cause)),
      ),
  };
};

export const layer = (namespace: Namespace): Layer.Layer<LinkEvents> =>
  Layer.succeed(LinkEvents)(make(namespace));

/** Publishes nowhere: for a Worker deployed without the binding. */
export const layerNoop: Layer.Layer<LinkEvents> = Layer.succeed(LinkEvents)({
  publish: () => Effect.void,
  publishAll: () => Effect.void,
  close: () => Effect.void,
});
