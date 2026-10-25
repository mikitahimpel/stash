import { describe, expect, it } from "@effect/vitest";
import * as Alarms from "@stash/ext-platform/browser-alarms";
import * as Storage from "@stash/ext-platform/browser-storage";
import * as ExtensionConfig from "@stash/ext-platform/extension-config";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as TabSync from "../src/tab-sync.ts";

// Lets the forked sync loop subscribe and process what it was sent.
const settle = Effect.repeat(Effect.yieldNow, { times: 50 });

// Synthetic config: an invented origin and a placeholder token.
const config = { apiBaseUrl: "https://api.example.com", deviceToken: "synthetic-token" };

interface Report {
  readonly path: string;
  readonly body: { readonly takenAt: string; readonly tabs: ReadonlyArray<{ url: string }> };
}

/** A fake API: `/auth/me` answers a device, `PUT /devices/:id/tabs` is recorded. */
const fakeApi = (options: { readonly status?: () => number } = {}) => {
  const reports: Array<Report> = [];
  const handler: Testing.Options["handler"] = (request) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      if (url.pathname === "/auth/me") {
        return Response.json({ kind: "device", deviceId: "device-1" });
      }
      if (request.method === "PUT" && url.pathname === "/devices/device-1/tabs") {
        const status = options.status?.() ?? 204;
        if (status !== 204) return new Response(null, { status });
        const body = request.body;
        const text = body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "";
        reports.push({ path: url.pathname, body: JSON.parse(text) });
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    });
  return { reports, handler };
};

const tabs = [
  Testing.tab({ id: 1, url: "https://example.com/a", title: "A" }),
  Testing.tab({ id: 2, url: "about:config", title: "Config" }),
  Testing.tab({ id: 3, url: null, title: null }),
  Testing.tab({ id: 4, url: "https://example.com/b", title: "B", hidden: true }),
];

const urls = (report: Report | undefined) => report?.body.tabs.map((tab) => tab.url);

// Builds the feature on the platform services the test provides, so both share one state.
const run = (options: TabSync.Options = {}) =>
  Effect.andThen(Layer.build(TabSync.layer(options)), settle);

describe("tab sync", () => {
  it.effect("posts a snapshot of the http(s) tabs on start and creates the alarm", () => {
    const api = fakeApi();
    const platform = Testing.make({ tabs, config, handler: api.handler });
    return Effect.gen(function* () {
      yield* run();
      expect(api.reports).toHaveLength(1);
      expect(urls(api.reports[0])).toEqual(["https://example.com/a", "https://example.com/b"]);
      expect(api.reports[0]?.body.tabs[0]).toMatchObject({ title: "A", openedAt: null });
      expect(yield* (yield* Alarms.Alarms).list).toMatchObject([
        { name: TabSync.alarmName, periodInMinutes: 5 },
      ]);
      expect(Option.isSome(yield* (yield* Storage.Storage).get(TabSync.lastHashKey))).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(platform));
  });

  it.effect("on the alarm, skips unchanged tabs and posts changed ones", () => {
    const api = fakeApi();
    const platform = Testing.make({ tabs, config, handler: api.handler });
    return Effect.gen(function* () {
      yield* run({ periodInMinutes: 10 });
      const alarms = yield* Testing.TestAlarms;
      expect(yield* (yield* Alarms.Alarms).list).toMatchObject([{ periodInMinutes: 10 }]);

      yield* alarms.fire(TabSync.alarmName);
      yield* settle;
      expect(api.reports).toHaveLength(1);

      yield* (yield* Testing.TestTabs).set([Testing.tab({ id: 5, url: "https://example.com/c" })]);
      yield* alarms.fire(TabSync.alarmName);
      yield* settle;
      expect(api.reports).toHaveLength(2);
      expect(urls(api.reports[1])).toEqual(["https://example.com/c"]);

      // Other alarms are not ours.
      yield* (yield* Alarms.Alarms).create("other", { periodInMinutes: 1 });
      yield* (yield* Testing.TestTabs).set([]);
      yield* alarms.fire("other");
      yield* settle;
      expect(api.reports).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(platform));
  });

  it.effect("debounces tab events into one snapshot", () => {
    const api = fakeApi();
    const platform = Testing.make({ tabs, config, handler: api.handler });
    return Effect.gen(function* () {
      yield* run();
      const testTabs = yield* Testing.TestTabs;
      for (const id of [6, 7, 8]) {
        yield* testTabs.set([...tabs, Testing.tab({ id, url: `https://example.com/${id}` })]);
        yield* settle;
        yield* TestClock.adjust("1 second");
        yield* settle;
      }
      expect(api.reports).toHaveLength(1);
      yield* TestClock.adjust("2 seconds");
      yield* settle;
      expect(api.reports).toHaveLength(2);
      expect(urls(api.reports[1])?.at(-1)).toBe("https://example.com/8");
    }).pipe(Effect.scoped, Effect.provide(platform));
  });

  it.effect("skips on start when the stored hash matches", () => {
    const first = fakeApi();
    const second = fakeApi();
    return Effect.gen(function* () {
      const firstPlatform = Testing.make({ tabs, config, handler: first.handler });
      const stored = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* run();
          return yield* (yield* Storage.Storage).get(TabSync.lastHashKey);
        }).pipe(Effect.provide(firstPlatform)),
      );
      expect(first.reports).toHaveLength(1);

      // The event page woke up again with the same tabs.
      const secondPlatform = Testing.make({
        tabs,
        config,
        handler: second.handler,
        storage: { [TabSync.lastHashKey]: Option.getOrThrow(stored) },
      });
      yield* Effect.scoped(Effect.provide(run(), secondPlatform));
      expect(second.reports).toHaveLength(0);
    });
  });

  it.effect("waits for a config, then posts when one is saved", () => {
    const api = fakeApi();
    const platform = Testing.make({ tabs, handler: api.handler });
    return Effect.gen(function* () {
      yield* run();
      expect(api.reports).toHaveLength(0);
      yield* (yield* Storage.Storage).set(ExtensionConfig.storageKey, config);
      yield* settle;
      expect(api.reports).toHaveLength(1);
      // Saving the config again resends, as the new token may belong to another device.
      yield* (yield* Storage.Storage).set(ExtensionConfig.storageKey, config);
      yield* settle;
      expect(api.reports).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(platform));
  });

  it.effect("keeps running after an API error and retries on the next trigger", () => {
    let status = 500;
    const api = fakeApi({ status: () => status });
    const platform = Testing.make({ tabs, config, handler: api.handler });
    return Effect.gen(function* () {
      yield* run();
      expect(api.reports).toHaveLength(0);
      expect(yield* (yield* Storage.Storage).get(TabSync.lastHashKey)).toEqual(Option.none());
      status = 204;
      yield* (yield* Testing.TestAlarms).fire(TabSync.alarmName);
      yield* settle;
      expect(api.reports).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(platform));
  });
});
