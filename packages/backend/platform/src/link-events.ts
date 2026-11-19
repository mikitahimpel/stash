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
    /** Sends the event to every open stream of the user. */
    readonly publish: (event: Published) => Effect.Effect<void>;
    /** Sends several events in one call, in order: the links of one batch save. */
    readonly publishAll: (events: ReadonlyArray<Published>) => Effect.Effect<void>;
  }
>()("@stash/backend-platform/LinkEvents") {}

/**
 * The path of the object that takes events to broadcast: one JSON text per line of the body (the
 * JSON of an event has no line break in it). Any other path opens a stream.
 */
export const publishPath = "/publish";

/** How long a publish may take before the write goes on without it. */
export const publishTimeoutMillis = 2000;

/** The part of a Durable Object stub this package uses. `DurableObjectStub` satisfies it. */
export interface Stub {
  fetch(input: string, init: { method: string; body: string }): Promise<{ status: number }>;
}

/** The part of the namespace binding this package uses. `DurableObjectNamespace` satisfies it. */
export interface Namespace<S = Stub> {
  idFromName(name: string): unknown;
  get(id: never): S;
}

/**
 * The object that holds one user's streams. Stash has one user, the allowlisted login, and every
 * principal (the session, each device token, the MCP token) acts for them, so `user` is that login.
 */
export const stub = <S>(namespace: Namespace<S>, user: string): S =>
  namespace.get(namespace.idFromName(user) as never);

const encode = Schema.encodeSync(LinkEvent.LinkEventFromJson);

/** Publishes to the user's object. */
export const make = (namespace: Namespace, user: string): LinkEvents["Service"] => {
  const publishAll = (events: ReadonlyArray<Published>): Effect.Effect<void> =>
    events.length === 0
      ? Effect.void
      : Effect.tryPromise(() =>
          stub(namespace, user).fetch(`https://link-events${publishPath}`, {
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
  return { publish: (event) => publishAll([event]), publishAll };
};

export const layer = (namespace: Namespace, user: string): Layer.Layer<LinkEvents> =>
  Layer.succeed(LinkEvents)(make(namespace, user));

/** Publishes nowhere: for a Worker deployed without the binding. */
export const layerNoop: Layer.Layer<LinkEvents> = Layer.succeed(LinkEvents)({
  publish: () => Effect.void,
  publishAll: () => Effect.void,
});
