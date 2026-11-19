import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

/**
 * The connection could not be made, or it ended: the server closed it (`closed`), the network
 * failed (`error`), or the keep-alive got no answer (`silent`).
 */
export class LiveSocketError extends Data.TaggedError("LiveSocketError")<{
  readonly reason: "closed" | "error" | "silent";
}> {}

/**
 * How a connection proves it is alive: the client sends `ping` every `everyMillis`, and a server
 * that does not send `pong` within `timeoutMillis` is gone. Pongs are not emitted as messages.
 */
export interface KeepAlive {
  readonly ping: string;
  readonly pong: string;
  readonly everyMillis: number;
  readonly timeoutMillis: number;
}

/** Text messages a server pushes over a WebSocket. */
export class LiveSocket extends Context.Service<
  LiveSocket,
  {
    /**
     * Opens a WebSocket to `url` and emits each text message. `url` is an `http(s)` address or a
     * path on this origin (`/api/events`); the socket uses the matching `ws(s)` scheme, and the
     * browser sends the origin's cookies with it. The stream never ends by itself: it fails with
     * `LiveSocketError` when the connection cannot be made or drops. Interrupting it closes the
     * socket.
     */
    readonly messages: (
      url: string,
      options?: { readonly keepAlive?: KeepAlive },
    ) => Stream.Stream<string, LiveSocketError>;
  }
>()("@stash/web-platform/LiveSocket") {}

/** The `ws(s)` address of an `http(s)` address or a path on `base`. */
export const socketUrl = (url: string, base: string): string => {
  const target = new URL(url, base);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  return target.href;
};

/** The live service, backed by the browser's `WebSocket`. */
export const layer: Layer.Layer<LiveSocket> = Layer.succeed(LiveSocket)({
  messages: (url, options) =>
    Stream.callback<string, LiveSocketError>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const keepAlive = options?.keepAlive;
          let pingTimer: ReturnType<typeof setInterval> | undefined;
          let pongTimer: ReturnType<typeof setTimeout> | undefined;
          const stop = () => {
            clearInterval(pingTimer);
            clearTimeout(pongTimer);
          };
          const fail = (reason: LiveSocketError["reason"]) => {
            stop();
            Queue.failCauseUnsafe(queue, Cause.fail(new LiveSocketError({ reason })));
          };
          let socket: WebSocket;
          try {
            socket = new WebSocket(socketUrl(url, window.location.href));
          } catch {
            fail("error");
            return () => {};
          }
          socket.addEventListener("open", () => {
            if (keepAlive === undefined) return;
            pingTimer = setInterval(() => {
              if (socket.readyState !== WebSocket.OPEN) return;
              socket.send(keepAlive.ping);
              pongTimer ??= setTimeout(() => fail("silent"), keepAlive.timeoutMillis);
            }, keepAlive.everyMillis);
          });
          socket.addEventListener("message", (event) => {
            if (typeof event.data !== "string") return;
            if (keepAlive !== undefined && event.data === keepAlive.pong) {
              clearTimeout(pongTimer);
              pongTimer = undefined;
              return;
            }
            Queue.offerUnsafe(queue, event.data);
          });
          socket.addEventListener("error", () => fail("error"));
          socket.addEventListener("close", () => fail("closed"));
          return () => {
            stop();
            socket.close();
          };
        }),
        (close) => Effect.sync(close),
      ),
    ),
});
