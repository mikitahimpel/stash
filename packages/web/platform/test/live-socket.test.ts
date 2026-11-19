import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as LiveSocket from "../src/live-socket.ts";
import * as Testing from "../src/testing.ts";

// Lets the forked stream connect before the test drives the server's side.
const settle = Effect.repeat(Effect.yieldNow, { times: 10 });

/** A stand-in for the browser's `WebSocket`: the test plays the server. */
class FakeSocket extends EventTarget {
  static readonly OPEN = 1;
  static sockets: Array<FakeSocket> = [];
  readyState = 0;
  readonly sent: Array<string> = [];
  closed = false;
  constructor(readonly url: string) {
    super();
    FakeSocket.sockets.push(this);
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.closed = true;
  }
  accept() {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
  message(data: unknown) {
    this.dispatchEvent(Object.assign(new Event("message"), { data }));
  }
}

const messages = (url: string, keepAlive?: LiveSocket.KeepAlive) =>
  Stream.unwrap(
    Effect.map(LiveSocket.LiveSocket, (socket) =>
      socket.messages(url, keepAlive === undefined ? undefined : { keepAlive }),
    ),
  );

beforeEach(() => {
  FakeSocket.sockets = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", { location: { href: "https://stash.example.com/links?feed=all" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("socketUrl", () => {
  it("turns a path or an http(s) address into the ws(s) one", () => {
    const base = "https://stash.example.com/links";
    expect(LiveSocket.socketUrl("/api/events", base)).toBe("wss://stash.example.com/api/events");
    expect(LiveSocket.socketUrl("/api/events", "http://localhost:5173/")).toBe(
      "ws://localhost:5173/api/events",
    );
    expect(LiveSocket.socketUrl("https://api.example.com/events", base)).toBe(
      "wss://api.example.com/events",
    );
  });
});

describe("LiveSocket (live)", () => {
  it.effect("emits the server's text messages and closes the socket when the reader leaves", () =>
    Effect.gen(function* () {
      const fiber = yield* messages("/api/events").pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* settle;
      const socket = FakeSocket.sockets[0]!;
      expect(socket.url).toBe("wss://stash.example.com/api/events");
      socket.accept();
      socket.message("one");
      socket.message(new ArrayBuffer(1));
      socket.message("two");
      expect(yield* Fiber.join(fiber)).toEqual(["one", "two"]);
      expect(socket.closed).toBe(true);
    }).pipe(Effect.provide(LiveSocket.layer)),
  );

  it.effect("fails when the connection cannot be made, and when it drops", () =>
    Effect.gen(function* () {
      const refused = yield* messages("/api/events").pipe(
        Stream.runDrain,
        Effect.flip,
        Effect.forkChild,
      );
      yield* settle;
      FakeSocket.sockets[0]!.dispatchEvent(new Event("error"));
      expect(yield* Fiber.join(refused)).toEqual(
        new LiveSocket.LiveSocketError({ reason: "error" }),
      );

      const dropped = yield* messages("/api/events").pipe(
        Stream.runDrain,
        Effect.flip,
        Effect.forkChild,
      );
      yield* settle;
      FakeSocket.sockets[1]!.accept();
      FakeSocket.sockets[1]!.dispatchEvent(new Event("close"));
      expect(yield* Fiber.join(dropped)).toEqual(
        new LiveSocket.LiveSocketError({ reason: "closed" }),
      );
    }).pipe(Effect.provide(LiveSocket.layer)),
  );

  // Real timers: the keep-alive runs on the browser's, not on the Effect clock.
  it.live("pings an open connection, hides the pongs, and gives up on a silent server", () => {
    const keepAlive = { ping: "ping", pong: "pong", everyMillis: 40, timeoutMillis: 25 };
    const wait = (millis: number) =>
      Effect.promise(() => new Promise((resolve) => setTimeout(resolve, millis)));
    return Effect.gen(function* () {
      const seen: Array<string> = [];
      const fiber = yield* messages("/api/events", keepAlive).pipe(
        Stream.runForEach((message) => Effect.sync(() => void seen.push(message))),
        Effect.flip,
        Effect.forkChild,
      );
      yield* settle;
      const socket = FakeSocket.sockets[0]!;
      socket.accept();

      // An answered ping keeps the connection.
      yield* Effect.promise(() => vi.waitFor(() => expect(socket.sent).toEqual(["ping"])));
      socket.message("pong");
      socket.message("event");
      yield* wait(30);
      expect(seen).toEqual(["event"]);
      expect(socket.closed).toBe(false);

      // The next one gets no answer.
      expect(yield* Fiber.join(fiber)).toEqual(
        new LiveSocket.LiveSocketError({ reason: "silent" }),
      );
      expect(socket.sent).toEqual(["ping", "ping"]);
      expect(socket.closed).toBe(true);
    }).pipe(Effect.provide(LiveSocket.layer));
  });
});

describe("LiveSocket (in memory)", () => {
  it.effect("plays the server: sends to every open connection, drops them, refuses new ones", () =>
    Effect.gen(function* () {
      const server = yield* Testing.TestLiveSocket;
      const first = yield* messages("/api/events").pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* settle;
      expect(yield* server.open).toBe(1);
      yield* server.send("hello");
      expect(yield* Fiber.join(first)).toEqual(["hello"]);
      yield* settle;
      expect(yield* server.open).toBe(0);

      const dropped = yield* messages("/api/events").pipe(
        Stream.runDrain,
        Effect.flip,
        Effect.forkChild,
      );
      yield* settle;
      yield* server.drop();
      expect((yield* Fiber.join(dropped)).reason).toBe("closed");

      yield* server.setReachable(false);
      const refused = yield* messages("/api/events").pipe(Stream.runDrain, Effect.flip);
      expect(refused.reason).toBe("error");
      expect(yield* server.opened).toEqual(["/api/events", "/api/events", "/api/events"]);
    }).pipe(Effect.provide(Testing.layerLiveSocket())),
  );
});
