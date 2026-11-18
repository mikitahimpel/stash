import { Schema } from "effect";
import * as Link from "./link.ts";

// What the live stream (`GET /events`, a WebSocket) carries. The server sends each event as one
// text message holding its JSON. `at` is the server's clock, so a client that keeps the `at` of the
// last event it saw can ask for what it missed (`GET /links?updatedSince=<at>`) whatever its own
// clock says.

/** A link changed: enrichment finished, its metadata was filled, or a client edited it. */
export const LinkUpdated = Schema.Struct({
  type: Schema.Literal("link.updated"),
  at: Schema.DateTimeUtcFromString,
  /** The whole link as it is now, so a client replaces its copy and asks for nothing. */
  link: Link.Link,
});
export type LinkUpdated = typeof LinkUpdated.Type;

/** A link was deleted. */
export const LinkDeleted = Schema.Struct({
  type: Schema.Literal("link.deleted"),
  at: Schema.DateTimeUtcFromString,
  id: Link.LinkId,
});
export type LinkDeleted = typeof LinkDeleted.Type;

/** The first message of every stream: it is open, and this is the server's time. */
export const StreamReady = Schema.Struct({
  type: Schema.Literal("stream.ready"),
  at: Schema.DateTimeUtcFromString,
});
export type StreamReady = typeof StreamReady.Type;

/** One message of the live stream, discriminated by `type`. */
export const LinkEvent = Schema.Union([LinkUpdated, LinkDeleted, StreamReady]);
export type LinkEvent = typeof LinkEvent.Type;

/** A `LinkEvent` as the text of one stream message. */
export const LinkEventFromJson = Schema.fromJsonString(LinkEvent);

/**
 * The keep-alive of the stream, outside the events: a client that sends the text `ping` gets the
 * text `pong` back, and a client that gets none knows its connection is dead.
 */
export const ping = "ping";
export const pong = "pong";
