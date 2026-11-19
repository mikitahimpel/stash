import { describe, expect, it } from "@effect/vitest";
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
        calls.push({ name, url, ...init });
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
      yield* LinkEvents.make(namespace, "example-user").publish(deleted);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ name: "example-user", method: "POST" });
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
      const events = LinkEvents.make(namespace, "example-user");
      yield* events.publishAll([]);
      expect(calls).toHaveLength(0);
      yield* events.publishAll([deleted, { ...deleted, id: Link.LinkId.make("link-2") }]);
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
      yield* LinkEvents.make(rejecting.namespace, "example-user").publish(deleted);
      const throwing: LinkEvents.Namespace = {
        idFromName: () => {
          throw new Error("no binding");
        },
        get: () => ({ fetch: async () => ({ status: 200 }) }),
      };
      yield* LinkEvents.make(throwing, "example-user").publish(deleted);
    }),
  );

  it.effect("gives up on an object that does not answer", () =>
    Effect.gen(function* () {
      const hanging = fakeNamespace(() => new Promise(() => {}));
      const fiber = yield* Effect.forkChild(
        LinkEvents.make(hanging.namespace, "example-user").publish(deleted),
      );
      yield* TestClock.adjust(LinkEvents.publishTimeoutMillis);
      yield* Fiber.join(fiber);
      expect(hanging.calls).toHaveLength(1);
    }),
  );

  it.effect("keeps the events in the testing layer", () =>
    Effect.gen(function* () {
      yield* (yield* LinkEvents.LinkEvents).publish(deleted);
      expect(yield* (yield* Testing.TestLinkEvents).published).toEqual([deleted]);
    }).pipe(Effect.provide(Testing.layerLinkEvents)),
  );
});

describe("LinkEventsObject", () => {
  const socket = (fail = false) => {
    const sent: Array<string> = [];
    return {
      sent,
      send: (text: string | ArrayBuffer | ArrayBufferView) => {
        if (fail) throw new TypeError("WebSocket is closed");
        sent.push(String(text));
      },
    };
  };

  it("sends an event to every open stream, and a closed one is skipped", () => {
    const open = [socket(), socket()];
    const closed = socket(true);
    expect(LinkEventsObject.broadcast([open[0]!, closed, open[1]!], "event")).toBe(2);
    expect(open.map((s) => s.sent)).toEqual([["event"], ["event"]]);
  });

  it("opens every stream with the server's time", () => {
    const text = LinkEventsObject.ready(new Date("2026-01-02T03:04:05.000Z"));
    const event = Schema.decodeUnknownSync(LinkEvent.LinkEventFromJson)(text);
    expect(event.type).toBe("stream.ready");
    expect(DateTime.formatIso(event.at)).toBe("2026-01-02T03:04:05.000Z");
  });
});
