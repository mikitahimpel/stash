import { describe, expect, it } from "@effect/vitest";
import * as Alarms from "@stash/ext-platform/browser-alarms";
import * as Storage from "@stash/ext-platform/browser-storage";
import * as ExtensionConfig from "@stash/ext-platform/extension-config";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as RetryQueue from "../src/retry-queue.ts";
import * as SaveCurrentTab from "../src/save-current-tab.ts";

// Synthetic placeholders, not real values.
const config = { apiBaseUrl: "https://api.example.com", deviceToken: "synthetic-token" };

const tabs = [
  Testing.tab({ id: 1, url: "https://example.com/other", title: "Other" }),
  Testing.tab({ id: 2, url: "https://example.com/article", title: "  An article  ", active: true }),
];

const link = (url: string) => ({
  id: `link-${url.length}`,
  url,
  canonicalUrl: null,
  title: null,
  status: "new",
  type: null,
  summary: null,
  language: null,
  tags: [],
  sourceDeviceId: "device-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  enrichedAt: null,
});

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

/** A fake API whose answer to `POST /links` the test can change. */
const api = () => {
  const sent: Array<Sent> = [];
  let answer: (body: { url: string }) => Response = (body) =>
    Response.json(link(body.url), { status: 201 });
  const handler = (request: HttpClientRequest.HttpClientRequest) =>
    Effect.sync(() => {
      const body =
        request.body._tag === "Uint8Array"
          ? JSON.parse(new TextDecoder().decode(request.body.body))
          : null;
      sent.push({
        method: request.method,
        url: request.url,
        authorization: request.headers["authorization"],
        body,
      });
      return answer(body);
    });
  return {
    sent,
    handler,
    answer: (next: (body: { url: string }) => Response) => {
      answer = next;
    },
  };
};

const rateLimited = () =>
  Response.json({ _tag: "RateLimited", retryAfterSeconds: 120 }, { status: 429 });

/**
 * Runs `assertions` until they pass, letting the feature's fibers and the fake API's promises run
 * in between. Wall-clock, not a number of rounds: a busy CI machine runs the rounds slowly.
 */
const eventually = <A, E, R>(assertions: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const exit = yield* Effect.exit(assertions);
      if (exit._tag === "Success") return exit.value;
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1)));
    }
    return yield* assertions;
  });

/** Gives the feature time to react to something it should ignore. */
const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)));

const sentCount = (sent: ReadonlyArray<unknown>, count: number) =>
  Effect.sync(() => expect(sent).toHaveLength(count));

const badgeTitle = Effect.flatMap(Testing.TestToolbarAction, (action) =>
  Effect.map(
    action.badge,
    Option.map((badge) => badge.title),
  ),
);

const badgeText = Effect.flatMap(Testing.TestToolbarAction, (action) =>
  Effect.map(
    action.badge,
    Option.map((badge) => badge.text),
  ),
);

const queued = Effect.flatMap(Storage.Storage, (storage) => storage.get(RetryQueue.storageKey));

const retryAlarm = Effect.flatMap(Alarms.Alarms, (alarms) =>
  Effect.map(alarms.list, (all) => all.filter((alarm) => alarm.name === RetryQueue.alarmName)),
);

/** Runs `test` with the capture layer started on in-memory platform services. */
const withCapture = <A, E>(
  options: Testing.Options,
  test: Effect.Effect<A, E, Layer.Success<ReturnType<typeof Testing.make>>>,
) =>
  Effect.scoped(Effect.andThen(Layer.build(SaveCurrentTab.layer), test)).pipe(
    Effect.provide(Testing.make(options)),
  );

const press = Effect.flatMap(Testing.TestCommands, (commands) =>
  commands.trigger(SaveCurrentTab.commandName),
);

describe("save current tab", () => {
  it.effect("the hotkey saves the active tab with POST /links and shows ✓", () => {
    const { sent, handler } = api();
    return withCapture(
      { tabs, config, handler },
      Effect.gen(function* () {
        yield* press;
        yield* sentCount(sent, 1).pipe(eventually);
        expect(sent).toEqual([
          {
            method: "POST",
            url: "https://api.example.com/links",
            authorization: "Bearer synthetic-token",
            body: { url: "https://example.com/article", title: "An article" },
          },
        ]);
        yield* Effect.map(badgeText, (text) => expect(text).toEqual(Option.some("✓"))).pipe(
          eventually,
        );
        const history = yield* (yield* Testing.TestToolbarAction).history;
        expect(history.map((badge) => badge?.text ?? null)).toEqual(["…", "✓"]);
        yield* TestClock.adjust("4 seconds");
        yield* Effect.map(badgeText, (text) => expect(text).toEqual(Option.none())).pipe(
          eventually,
        );
        expect(yield* queued).toEqual(Option.none());
      }),
    );
  });

  it.effect("a click on the toolbar button saves too, other commands don't", () => {
    const { sent, handler } = api();
    return withCapture(
      { tabs, config, handler },
      Effect.gen(function* () {
        yield* (yield* Testing.TestCommands).trigger("save-all-and-close");
        yield* settle;
        expect(sent).toEqual([]);
        yield* (yield* Testing.TestToolbarAction).click;
        yield* sentCount(sent, 1).pipe(eventually);
        expect(sent[0]?.body).toEqual({ url: "https://example.com/article", title: "An article" });
      }),
    );
  });

  it.effect("a page that is not http(s) is not sent", () => {
    const { sent, handler } = api();
    return withCapture(
      { tabs: [Testing.tab({ id: 1, url: "about:config", active: true })], config, handler },
      Effect.gen(function* () {
        yield* press;
        yield* Effect.map(badgeTitle, (title) =>
          expect(title).toEqual(Option.some("Only http(s) pages can be saved to Stash.")),
        ).pipe(eventually);
        expect(sent).toEqual([]);
      }),
    );
  });

  it.effect("leaves out a missing title", () => {
    const { sent, handler } = api();
    return withCapture(
      { tabs: [Testing.tab({ id: 1, title: "  ", active: true })], config, handler },
      Effect.gen(function* () {
        yield* press;
        yield* sentCount(sent, 1).pipe(eventually);
        expect(sent[0]?.body).toEqual({ url: "https://example.com/tabs/1" });
      }),
    );
  });

  it.effect("rate limited: queues the link and the retry alarm sends it", () => {
    const api_ = api();
    api_.answer(rateLimited);
    return withCapture(
      { tabs, config, handler: api_.handler },
      Effect.gen(function* () {
        yield* press;
        yield* Effect.map(badgeText, (text) => expect(text).toEqual(Option.some("wait"))).pipe(
          eventually,
        );
        expect(yield* queued).toEqual(
          Option.some([{ url: "https://example.com/article", title: "An article" }]),
        );
        const [alarm] = yield* retryAlarm;
        expect(alarm?.scheduledTime).toBe(120_000);

        api_.answer((body) => Response.json(link(body.url), { status: 201 }));
        expect(yield* (yield* Testing.TestAlarms).fire(RetryQueue.alarmName)).toBe(true);
        yield* Effect.gen(function* () {
          expect(yield* queued).toEqual(Option.none());
          expect(yield* retryAlarm).toEqual([]);
        }).pipe(eventually);
        expect(api_.sent).toHaveLength(2);
      }),
    );
  });

  it.effect("offline (5xx): queues the link and retries after a minute", () => {
    const api_ = api();
    api_.answer(() => new Response("unavailable", { status: 503 }));
    return withCapture(
      { tabs, config, handler: api_.handler },
      Effect.gen(function* () {
        yield* press;
        yield* Effect.map(badgeText, (text) => expect(text).toEqual(Option.some("off"))).pipe(
          eventually,
        );
        expect(Option.isSome(yield* queued)).toBe(true);
        const [alarm] = yield* retryAlarm;
        expect(alarm?.scheduledTime).toBe(60_000);

        // Still offline: the link stays queued and the alarm is set again.
        yield* (yield* Testing.TestAlarms).fire(RetryQueue.alarmName);
        yield* Effect.gen(function* () {
          expect(api_.sent).toHaveLength(2);
          expect(yield* retryAlarm).toHaveLength(1);
        }).pipe(eventually);
        expect(Option.isSome(yield* queued)).toBe(true);
      }),
    );
  });

  it.effect("a rejected link is not queued", () => {
    const api_ = api();
    api_.answer(() => new Response("bad request", { status: 400 }));
    return withCapture(
      { tabs, config, handler: api_.handler },
      Effect.gen(function* () {
        yield* press;
        yield* Effect.map(badgeTitle, (title) =>
          expect(title).toEqual(Option.some("Stash could not save this tab.")),
        ).pipe(eventually);
        expect(api_.sent).toHaveLength(1);
        expect(yield* queued).toEqual(Option.none());
        expect(yield* retryAlarm).toEqual([]);
      }),
    );
  });

  it.effect("without a config: queues the link and sends it once the config is saved", () => {
    const { sent, handler } = api();
    return withCapture(
      { tabs, handler },
      Effect.gen(function* () {
        yield* press;
        yield* Effect.map(badgeText, (text) => expect(text).toEqual(Option.some("!"))).pipe(
          eventually,
        );
        expect(sent).toEqual([]);
        expect(Option.isSome(yield* queued)).toBe(true);
        expect(yield* retryAlarm).toEqual([]);

        yield* (yield* ExtensionConfig.ExtensionConfig).set({
          apiBaseUrl: config.apiBaseUrl,
          deviceToken: Redacted.make(config.deviceToken),
        });
        yield* Effect.map(queued, (value) => expect(value).toEqual(Option.none())).pipe(eventually);
        expect(sent.map((request) => request.url)).toEqual(["https://api.example.com/links"]);
      }),
    );
  });

  it.effect("a rejected device token queues the link like a missing config", () => {
    const api_ = api();
    api_.answer(() => Response.json({ _tag: "Unauthorized", message: "Invalid" }, { status: 401 }));
    return withCapture(
      { tabs, config, handler: api_.handler },
      Effect.gen(function* () {
        yield* press;
        yield* Effect.map(badgeTitle, (title) =>
          expect(title).toEqual(
            Option.some("Queued. Set the API URL and device token in the Stash settings."),
          ),
        ).pipe(eventually);
        expect(Option.isSome(yield* queued)).toBe(true);
      }),
    );
  });

  it.effect("sends the links queued before the page started, oldest first", () => {
    const { sent, handler } = api();
    const links = [{ url: "https://example.com/first" }, { url: "https://example.com/second" }];
    return withCapture(
      { tabs, config, handler, storage: { [RetryQueue.storageKey]: links } },
      Effect.gen(function* () {
        yield* Effect.map(queued, (value) => expect(value).toEqual(Option.none())).pipe(eventually);
        expect(sent.map((request) => request.body)).toEqual(links);
        expect(yield* queued).toEqual(Option.none());
      }),
    );
  });
});
