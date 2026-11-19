import * as LinkEvent from "@stash/contracts-domain/link-event";
import * as LinkEvents from "./link-events.ts";

// The Durable Object behind `GET /events`: one per user, holding that user's open WebSockets.
//
// It uses the WebSocket Hibernation API: the runtime keeps the sockets while the object sleeps, so
// an open stream costs nothing between events. That is why nothing lives in memory here: each
// call reads the sockets from the runtime (`getWebSockets`), and the keep-alive (`ping` → `pong`)
// is an auto response, which does not wake the object.
//
// The Worker authenticates a request before it gets here and picks the object by the user's id
// (`LinkEvents.stub`). A named object is reachable only through the Worker's binding.

/**
 * The most streams one object holds. A tab holds one while it is visible, so one person's
 * browsers stay far below it; past it a new stream is refused (503) and its client falls back to
 * asking, until an older stream closes.
 */
export const maxStreams = 32;

/** The part of `DurableObjectState` the object uses. */
export interface State {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): Array<Pick<WebSocket, "send" | "close">>;
  /** The object's storage. Nothing is kept there today; a removed user's object is still cleared. */
  readonly storage?: { deleteAll(): Promise<unknown> };
  setWebSocketAutoResponse(pair?: WebSocketRequestResponsePair): void;
}

/** The close code of a stream whose user was removed: the client must not reconnect. */
export const removedCloseCode = 4001;

/** The first message of a stream, as text. */
export const ready = (now: Date): string =>
  JSON.stringify({ type: "stream.ready", at: now.toISOString() } satisfies Record<
    keyof LinkEvent.StreamReady,
    string
  >);

/** Sends `text` to every socket. A socket that is closing or gone is skipped. */
export const broadcast = (
  sockets: ReadonlyArray<Pick<WebSocket, "send">>,
  text: string,
): number => {
  let sent = 0;
  for (const socket of sockets) {
    try {
      socket.send(text);
      sent++;
    } catch {
      // The client left; the runtime drops the socket.
    }
  }
  return sent;
};

/** Sends each line of a publish body (one event per line) to every socket, in order. */
export const broadcastAll = (
  sockets: ReadonlyArray<Pick<WebSocket, "send">>,
  body: string,
): number => {
  let sent = 0;
  for (const text of body.split("\n")) if (text !== "") sent = broadcast(sockets, text);
  return sent;
};

/**
 * The object's handlers. The class the Worker exports extends `DurableObject` (from
 * `cloudflare:workers`, which only the Worker can import) and hands each call to this one.
 */
export class LinkEventsObject {
  constructor(private readonly state: State) {
    state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(LinkEvent.ping, LinkEvent.pong),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === LinkEvents.publishPath) {
      const sent = broadcastAll(this.state.getWebSockets(), await request.text());
      return Response.json({ sent });
    }
    if (request.method === "POST" && url.pathname === LinkEvents.closePath) {
      const sockets = this.state.getWebSockets();
      for (const socket of sockets) {
        try {
          socket.close(removedCloseCode, "The account was removed");
        } catch {
          // Closed already.
        }
      }
      await this.state.storage?.deleteAll();
      return Response.json({ closed: sockets.length });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }
    if (this.state.getWebSockets().length >= maxStreams) {
      return new Response("Too many open streams", { status: 503 });
    }
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    pair[1].send(ready(new Date()));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** The client closed: answer the close, so the socket ends cleanly on both sides. */
  webSocketClose(socket: Pick<WebSocket, "close">): void {
    try {
      socket.close(1000);
    } catch {
      // Closed already.
    }
  }
}
