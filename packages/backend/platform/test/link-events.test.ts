import { describe, expect, it, vi } from "@effect/vitest";
import * as Link from "@stash/contracts-domain/link";
import * as LinkEvent from "@stash/contracts-domain/link-event";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as LinkEvents from "../src/link-events.ts";
import * as LinkEventsObject from "../src/link-events-object.ts";
import * as Testing from "../src/testing.ts";

const deleted: LinkEvents.Published = {
  type: "link.deleted",
  at: DateTime.makeUnsafe("2026-01-02T03:04:05.000Z"),
  id: Schema.decodeSync(Link.LinkId)("link-1"),
};

/** A namespace whose one object answers `fetch` with `answer`, and what it was asked. */
const fakeNamespace = (answer: () => Promise<{ status: number }>) => {
  const calls: Array<{ name: string; url: string; method: string; body: string }> = [];
  const namespace: LinkEvents.Namespace = {
    idFromName: (name) => name,
    get: (name) => ({
      fetch: (url, init) => {
        calls.push({ name, url, method: init.method, body: init.body ?? "" });
        return answer();
      },
    }),
  };
  return { namespace, calls };
};

describe("LinkEvents", () => {
  it.effect("posts the event as JSON to the user's object", () =>
    Effect.gen(function* () {
      const { namespace, calls } = fakeNamespace(async () => ({ status: 200 }));
      yield* LinkEvents.make(namespace).publish("user-a", deleted);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ name: LinkEvents.objectName("user-a"), method: "POST" });
      expect(new URL(calls[0]!.url).pathname).toBe(LinkEvents.publishPath);
      expect(JSON.parse(calls[0]!.body)).toEqual({
        type: "link.deleted",
        at: "2026-01-02T03:04:05.000Z",
        id: "link-1",
      });
    }),
  );

  it.effect("posts several events in one call, one per line, and nothing for none", () =>
    Effect.gen(function* () {
      const { namespace, calls } = fakeNamespace(async () => ({ status: 200 }));
      const events = LinkEvents.make(namespace);
      yield* events.publishAll("user-a", []);
      expect(calls).toHaveLength(0);
      yield* events.publishAll("user-a", [deleted, { ...deleted, id: Link.LinkId.make("link-2") }]);
      expect(calls).toHaveLength(1);
      const lines = calls[0]!.body.split("\n");
      expect(lines.map((line) => (JSON.parse(line) as { id: string }).id)).toEqual([
        "link-1",
        "link-2",
      ]);
      // The object sends each line as its own message.
      const sent: Array<string> = [];
      LinkEventsObject.broadcastAll(
        [{ send: (text) => void sent.push(String(text)) }],
        calls[0]!.body,
      );
      expect(sent).toEqual(lines);
    }),
  );

  it.effect("never fails: an object that rejects or throws only loses the event", () =>
    Effect.gen(function* () {
      const rejecting = fakeNamespace(() => Promise.reject(new Error("object is overloaded")));
      yield* LinkEvents.make(rejecting.namespace).publish("user-a", deleted);
      const throwing: LinkEvents.Namespace = {
        idFromName: () => {
          throw new Error("no binding");
        },
        get: () => ({ fetch: async () => ({ status: 200 }) }),
      };
      yield* LinkEvents.make(throwing).publish("user-a", deleted);
    }),
  );

  it.effect("gives up on an object that does not answer", () =>
    Effect.gen(function* () {
      const hanging = fakeNamespace(() => new Promise(() => {}));
      const fiber = yield* Effect.forkChild(
        LinkEvents.make(hanging.namespace).publish("user-a", deleted),
      );
      yield* TestClock.adjust(LinkEvents.publishTimeoutMillis);
      yield* Fiber.join(fiber);
      expect(hanging.calls).toHaveLength(1);
    }),
  );

  it.effect("sends each user's events to that user's own object, and to no other", () =>
    Effect.gen(function* () {
      const { namespace, calls } = fakeNamespace(async () => ({ status: 200 }));
      const events = LinkEvents.make(namespace);
      yield* events.publish("user-a", deleted);
      yield* events.publish("user-b", { ...deleted, id: Link.LinkId.make("link-b") });
      expect(calls.map((call) => call.name)).toEqual([
        LinkEvents.objectName("user-a"),
        LinkEvents.objectName("user-b"),
      ]);
      expect(LinkEvents.objectName("user-a")).not.toBe(LinkEvents.objectName("user-b"));
      expect(calls[0]!.body).not.toContain("link-b");
      expect(calls[1]!.body).not.toContain("link-1");
    }),
  );

  it.effect("closes a removed user's object, and never fails doing it", () =>
    Effect.gen(function* () {
      const { namespace, calls } = fakeNamespace(async () => ({ status: 200 }));
      yield* LinkEvents.make(namespace).close("user-a");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ name: LinkEvents.objectName("user-a"), method: "POST" });
      expect(new URL(calls[0]!.url).pathname).toBe(LinkEvents.closePath);
      const rejecting = fakeNamespace(() => Promise.reject(new Error("gone")));
      yield* LinkEvents.make(rejecting.namespace).close("user-a");
    }),
  );

  it.effect("keeps the events in the testing layer, per user", () =>
    Effect.gen(function* () {
      const events = yield* LinkEvents.LinkEvents;
      const test = yield* Testing.TestLinkEvents;
      yield* events.publish("user-a", deleted);
      yield* events.close("user-b");
      expect(yield* test.published).toEqual([deleted]);
      expect(yield* test.publishedTo("user-a")).toEqual([deleted]);
      expect(yield* test.publishedTo("user-b")).toEqual([]);
      expect(yield* test.closed).toEqual(["user-b"]);
    }).pipe(Effect.provide(Testing.layerLinkEvents)),
  );
});

describe("LinkEventsObject", () => {
  const socket = (fail = false) => {
    const sent: Array<string> = [];
    const closed: Array<number | undefined> = [];
    return {
      sent,
      closed,
      send: (text: string | ArrayBuffer | ArrayBufferView) => {
        if (fail) throw new TypeError("WebSocket is closed");
        sent.push(String(text));
      },
      close: (code?: number) => void closed.push(code),
    };
  };

  it("sends an event to every open stream, and a closed one is skipped", () => {
    const open = [socket(), socket()];
    const closed = socket(true);
    expect(LinkEventsObject.broadcast([open[0]!, closed, open[1]!], "event")).toBe(2);
    expect(open.map((s) => s.sent)).toEqual([["event"], ["event"]]);
  });

  it("refuses a stream past the cap, and tells a plain request to upgrade", async () => {
    // The object registers its keep-alive when it is made; Node has no such class.
    vi.stubGlobal("WebSocketRequestResponsePair", class {});
    try {
      const sockets = Array.from({ length: LinkEventsObject.maxStreams }, () => socket());
      let accepted = 0;
      const object = new LinkEventsObject.LinkEventsObject({
        acceptWebSocket: () => void accepted++,
        getWebSockets: () => sockets,
        setWebSocketAutoResponse: () => {},
      });
      const upgrade = new Request("https://link-events/", { headers: { upgrade: "websocket" } });
      expect((await object.fetch(upgrade)).status).toBe(503);
      expect(accepted).toBe(0);
      expect((await object.fetch(new Request("https://link-events/"))).status).toBe(426);
      // Publishing still reaches the streams that are open.
      const published = await object.fetch(
        new Request(`https://link-events${LinkEvents.publishPath}`, {
          method: "POST",
          body: "one\ntwo",
        }),
      );
      expect(await published.json()).toEqual({ sent: LinkEventsObject.maxStreams });
      expect(sockets[0]!.sent).toEqual(["one", "two"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("closes every stream and clears its storage when its user is removed", async () => {
    vi.stubGlobal("WebSocketRequestResponsePair", class {});
    try {
      const sockets = [socket(), socket()];
      let cleared = 0;
      const object = new LinkEventsObject.LinkEventsObject({
        acceptWebSocket: () => {},
        getWebSockets: () => sockets,
        setWebSocketAutoResponse: () => {},
        storage: { deleteAll: async () => void cleared++ },
      });
      const answer = await object.fetch(
        new Request(`https://link-events${LinkEvents.closePath}`, { method: "POST" }),
      );
      expect(await answer.json()).toEqual({ closed: 2 });
      expect(sockets.map((s) => s.closed)).toEqual([
        [LinkEventsObject.removedCloseCode],
        [LinkEventsObject.removedCloseCode],
      ]);
      expect(cleared).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens every stream with the server's time", () => {
    const text = LinkEventsObject.ready(new Date("2026-01-02T03:04:05.000Z"));
    const event = Schema.decodeUnknownSync(LinkEvent.LinkEventFromJson)(text);
    expect(event.type).toBe("stream.ready");
    expect(DateTime.formatIso(event.at)).toBe("2026-01-02T03:04:05.000Z");
  });
});
