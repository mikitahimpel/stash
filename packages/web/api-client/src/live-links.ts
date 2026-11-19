import * as Events from "@stash/contracts-api/events";
import * as LinksGroup from "@stash/contracts-api/links";
import type * as Link from "@stash/contracts-domain/link";
import * as LinkEvent from "@stash/contracts-domain/link-event";
import * as WebPlatform from "@stash/web-platform/live";
import * as LiveSocket from "@stash/web-platform/live-socket";
import * as Visibility from "@stash/web-platform/visibility";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as ApiBaseUrl from "./api-base-url.ts";
import * as LinkPatches from "./link-patches.ts";
import { StashApiClient } from "./stash-api-client.ts";

// Live link updates: the page learns that a link changed (enrichment finished, another device
// marked it read) without a reload and without asking again.
//
// - One connection per tab, to the stream `GET /events`, open only while the tab is visible.
//   Each event is laid over the cached answers (`LinkPatches`), so rows change in place.
// - The stream replays nothing. Whenever it opens again, and whenever the window gets the focus
//   back, one cheap request asks for what changed since the last event seen
//   (`GET /links?updatedSince=`), by the server's clock.
// - A stream that drops is opened again, after 1 s, 2 s, 4 s … up to 30 s.
// - While there is no stream, only the links on screen that are still being enriched are asked
//   for (`GET /links?ids=`): after 3 s, 6 s … up to 30 s, from 3 s again when a new one shows
//   up, and not at all when nothing is pending. While the stream is open nothing wakes for it.

/** The keep-alive of the stream: a server that does not answer a ping is gone. */
export const keepAlive: LiveSocket.KeepAlive = {
  ping: LinkEvent.ping,
  pong: LinkEvent.pong,
  everyMillis: 25_000,
  timeoutMillis: 10_000,
};

/** A wait that doubles from `firstMillis` up to `maxMillis`. */
export interface Backoff {
  readonly firstMillis: number;
  readonly maxMillis: number;
}

export interface Timings {
  /** The waits before the stream is opened again. */
  readonly reconnect: Backoff;
  /** The waits between two asks for the pending links while there is no stream. */
  readonly poll: Backoff;
}

export const defaultTimings: Timings = {
  reconnect: { firstMillis: 1000, maxMillis: 30_000 },
  poll: { firstMillis: 3000, maxMillis: 30_000 },
};

/** The waits of a registry. Tests shorten them. */
export const timings: Atom.Writable<Timings> = Atom.make(defaultTimings).pipe(Atom.keepAlive);

/** The most pages one catch-up reads. Past that the lists' own refresh brings the rest. */
export const catchUpMaxPages = 5;

/**
 * How far before the last event seen a catch-up asks from, in ms. An event carries the time the
 * api published it, a little after the write was committed (`updatedAt`); a write committed just
 * before the last event but published after the stream dropped would be missed without it.
 */
export const catchUpOverlapMillis = 5000;

/** The address of the stream: the api's `/events`, same-origin by default. */
export const url = `${ApiBaseUrl.fromEnv.replace(/\/$/, "")}${Events.path}`;

/**
 * The stream and the visibility the connection runs on. Defaults to the browser's, from
 * `@stash/web-platform`. Tests replace it per registry with `@stash/web-platform/testing`.
 */
export const layer: Atom.Writable<Layer.Layer<LiveSocket.LiveSocket | Visibility.Visibility>> =
  Atom.make<Layer.Layer<LiveSocket.LiveSocket | Visibility.Visibility>>(
    Layer.mergeAll(WebPlatform.layerLiveSocket, WebPlatform.layerVisibility),
  ).pipe(Atom.keepAlive);

const runtime = Atom.runtime((get) => Layer.merge(get(StashApiClient.runtime.layer), get(layer)));

const decode = Schema.decodeUnknownOption(LinkEvent.LinkEventFromJson);

const next = (millis: number, { maxMillis }: Backoff) => Math.min(millis * 2, maxMillis);

const run = (registry: AtomRegistry.AtomRegistry) =>
  Effect.gen(function* () {
    const client = yield* StashApiClient;
    const socket = yield* LiveSocket.LiveSocket;
    const visibility = yield* Visibility.Visibility;
    const { reconnect, poll } = registry.get(timings);

    // Whether the stream is open, and the server's time of the last thing it said.
    let connected = false;
    // The same, for the polling to wait on.
    const open = yield* SubscriptionRef.make(false);
    const setConnected = (value: boolean) =>
      Effect.suspend(() => {
        connected = value;
        return SubscriptionRef.set(open, value);
      });
    let since: DateTime.Utc | undefined;
    let reconnectIn: number = reconnect.firstMillis;

    const patch = (links: ReadonlyArray<Link.Link>) =>
      Effect.sync(() => {
        for (const link of links) LinkPatches.update(registry, link);
      });

    // What changed since `from`, a few pages at most. A failure only leaves the rows as they are.
    const catchUp = (from: DateTime.Utc) =>
      Effect.gen(function* () {
        let cursor: string | undefined;
        for (let page = 0; page < catchUpMaxPages; page++) {
          const result = yield* client.links.list({
            query: {
              updatedSince: DateTime.subtract(from, { milliseconds: catchUpOverlapMillis }),
              limit: LinksGroup.maxPageSize,
              ...(cursor === undefined ? {} : { cursor }),
            },
          });
          yield* patch(result.items);
          if (result.nextCursor === null) return;
          cursor = result.nextCursor;
        }
      }).pipe(Effect.ignore);

    // The pending links on screen, asked for by id.
    const askPending = (ids: ReadonlySet<Link.LinkId>) =>
      ids.size === 0
        ? Effect.void
        : client.links
            .list({
              query: {
                ids: [...ids].slice(0, LinksGroup.maxPageSize),
                limit: LinksGroup.maxPageSize,
              },
            })
            .pipe(
              Effect.flatMap((page) => patch(page.items)),
              Effect.ignore,
            );

    const onMessage = (text: string) =>
      Effect.gen(function* () {
        const event = Option.getOrUndefined(decode(text));
        if (event === undefined) return;
        const previous = since;
        since = event.at;
        if (event.type !== "stream.ready") return LinkPatches.record(registry, event);
        yield* setConnected(true);
        reconnectIn = reconnect.firstMillis;
        // The gap before this stream: by time when an earlier one gave it, else by what waits.
        if (previous !== undefined) yield* catchUp(previous);
        else yield* askPending(LinkPatches.pending(registry));
      });

    const connection = Effect.gen(function* () {
      while (true) {
        yield* socket
          .messages(url, { keepAlive })
          .pipe(Stream.runForEach(onMessage), Effect.ignore);
        yield* setConnected(false);
        yield* Effect.sleep(reconnectIn);
        reconnectIn = next(reconnectIn, reconnect);
      }
    }).pipe(Effect.ensuring(setConnected(false)));

    const polling = Effect.gen(function* () {
      let wait: number = poll.firstMillis;
      let asked: ReadonlySet<Link.LinkId> = new Set();
      while (true) {
        // While the stream is open there is nothing to ask: sleep until it drops.
        if (connected) {
          yield* SubscriptionRef.changes(open).pipe(
            Stream.filter((isOpen) => !isOpen),
            Stream.take(1),
            Stream.runDrain,
          );
          wait = poll.firstMillis;
          asked = new Set();
        }
        yield* Effect.sleep(wait);
        const ids = connected ? new Set<Link.LinkId>() : LinkPatches.pending(registry);
        // Nothing to ask, or a link that was not asked for yet: the waits start over.
        const fresh = [...ids].some((id) => !asked.has(id));
        if (ids.size === 0 || fresh) wait = poll.firstMillis;
        else wait = next(wait, poll);
        asked = ids;
        yield* askPending(ids);
      }
    });

    const focus = visibility.focused.pipe(
      Stream.runForEach(() => (connected && since !== undefined ? catchUp(since) : Effect.void)),
    );

    const session = Effect.all([connection, polling, focus], {
      concurrency: "unbounded",
      discard: true,
    });

    // A hidden tab holds no connection and asks nothing; coming back starts a new session, whose
    // first `stream.ready` catches up from the last event the old one saw.
    yield* visibility.changes.pipe(
      Stream.switchMap((state) =>
        state === "visible" ? Stream.fromEffect(session) : Stream.empty,
      ),
      Stream.runDrain,
    );
  });

/**
 * The live connection of a tab. It runs while something mounts it: the app does for a signed-in
 * user (`apps/web/src/main.ts`). It holds no value worth reading.
 */
export const connection: Atom.Atom<unknown> = runtime.atom((get) => run(get.registry));
