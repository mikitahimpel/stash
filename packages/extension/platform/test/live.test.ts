import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as ToolbarAction from "../src/browser-action.ts";
import * as Alarms from "../src/browser-alarms.ts";
import * as Commands from "../src/browser-commands.ts";
import * as Storage from "../src/browser-storage.ts";
import * as Tabs from "../src/browser-tabs.ts";
import * as Windows from "../src/browser-windows.ts";
import * as Workspaces from "../src/browser-workspaces.ts";
import * as ExtensionConfig from "../src/extension-config.ts";
import * as Live from "../src/live.ts";
import * as StashApiClient from "../src/stash-api-client.ts";

// Lets a forked stream subscribe before the test fires an event.
const settle = Effect.repeat(Effect.yieldNow, { times: 10 });

/** A minimal `browser.events.Event` stand-in. */
const event = <Args extends ReadonlyArray<unknown>>() => {
  const listeners = new Set<(...args: Args) => void>();
  return {
    addListener: (listener: (...args: Args) => void) => void listeners.add(listener),
    removeListener: (listener: (...args: Args) => void) => void listeners.delete(listener),
    emit: (...args: Args) => listeners.forEach((listener) => listener(...args)),
    get size() {
      return listeners.size;
    },
  };
};

// Synthetic stand-in for the parts of `browser.*` the live layers call.
const fakeBrowser = () => {
  const local = new Map<string, unknown>();
  const onChanged = event<[Record<string, { oldValue?: unknown; newValue?: unknown }>, string]>();
  const onAlarm = event<[{ name: string; scheduledTime: number; periodInMinutes?: number }]>();
  const onCommand = event<[string]>();
  const tabEvents = {
    onCreated: event<[unknown]>(),
    onRemoved: event<[number, unknown]>(),
    onMoved: event<[number, unknown]>(),
    onAttached: event<[number, unknown]>(),
    onReplaced: event<[number, number]>(),
    onUpdated: event<[number, Record<string, unknown>, unknown]>(),
  };
  const onClicked = event<[unknown]>();
  const calls: Array<{ readonly api: string; readonly args: ReadonlyArray<unknown> }> = [];
  const record = (api: string, ...args: ReadonlyArray<unknown>) => calls.push({ api, args });
  const tabs = [
    { id: 1, windowId: 1, url: "https://example.com/a", title: "A", active: true, pinned: false },
    { id: 2, windowId: 1, active: false, pinned: true, hidden: true, lastAccessed: 5 },
    { id: -1, windowId: 1, active: false, pinned: false },
  ];
  const api = {
    tabs: {
      TAB_ID_NONE: -1,
      query: async (info: unknown) => (record("tabs.query", info), tabs),
      remove: async (ids: unknown) => void record("tabs.remove", ids),
      create: async (info: { windowId: number }) => (
        record("tabs.create", info),
        { id: 9, windowId: info.windowId, url: "about:newtab", active: false, pinned: false }
      ),
      ...tabEvents,
    },
    runtime: {
      getURL: (path: string) => `moz-extension://synthetic${path}`,
    },
    windows: {
      WINDOW_ID_NONE: -1,
      getAll: async (info: unknown) => (
        record("windows.getAll", info),
        [
          { id: 1, focused: true, incognito: false },
          { id: -1, focused: false, incognito: false },
        ]
      ),
      getLastFocused: async () => ({ id: 1, focused: true, incognito: false }),
      getCurrent: async () => ({ id: 3, focused: true, incognito: false }),
      create: async (info: unknown) => void record("windows.create", info),
      remove: async (id: number) => {
        if (id !== 1) throw new Error("No window with id");
      },
    },
    storage: {
      local: {
        get: async (key: string) => (local.has(key) ? { [key]: local.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) {
            const oldValue = local.get(key);
            local.set(key, value);
            onChanged.emit({ [key]: { oldValue, newValue: value } }, "local");
          }
        },
        remove: async (key: string) => {
          local.delete(key);
          onChanged.emit({ [key]: { oldValue: "x" } }, "local");
        },
      },
      onChanged,
    },
    alarms: {
      create: (name: string, info: unknown) => void record("alarms.create", name, info),
      clear: async (name: string) => name === "sync",
      getAll: async () => [{ name: "sync", scheduledTime: 10, periodInMinutes: 5 }],
      onAlarm,
    },
    commands: {
      getAll: async () => [
        { name: "save-tab", description: "Save the current tab", shortcut: "Alt+Shift+S" },
        { name: "save-all", description: "", shortcut: "" },
        { description: "unnamed" },
      ],
      onCommand,
    },
    browserAction: {
      setBadgeText: async (details: unknown) => void record("browserAction.setBadgeText", details),
      setBadgeBackgroundColor: async (details: unknown) =>
        void record("browserAction.setBadgeBackgroundColor", details),
      setTitle: async (details: unknown) => void record("browserAction.setTitle", details),
      onClicked,
    },
  };
  return { api, calls, local, onChanged, onAlarm, onCommand, tabEvents, onClicked };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("live layer", () => {
  it.effect("wraps browser.tabs and browser.windows", () => {
    const fake = fakeBrowser();
    vi.stubGlobal("browser", fake.api);
    return Effect.gen(function* () {
      const tabs = yield* Tabs.Tabs;
      expect(yield* tabs.query({ currentWindow: true, pinned: true })).toEqual([
        {
          id: 1,
          windowId: 1,
          url: "https://example.com/a",
          title: "A",
          active: true,
          pinned: false,
          hidden: false,
          lastAccessed: null,
        },
        {
          id: 2,
          windowId: 1,
          url: null,
          title: null,
          active: false,
          pinned: true,
          hidden: true,
          lastAccessed: 5,
        },
      ]);
      expect(Option.map(yield* tabs.current, (tab) => tab.id)).toEqual(Option.some(1));
      yield* tabs.remove([1, 2]);
      yield* tabs.remove([]);
      expect(yield* tabs.createBlank(1)).toMatchObject({ id: 9, windowId: 1, url: "about:newtab" });
      expect(fake.calls.filter((call) => call.api.startsWith("tabs."))).toEqual([
        { api: "tabs.query", args: [{ currentWindow: true, pinned: true }] },
        { api: "tabs.query", args: [{ currentWindow: true, active: true }] },
        { api: "tabs.remove", args: [[1, 2]] },
        { api: "tabs.create", args: [{ windowId: 1, active: false }] },
      ]);

      const windows = yield* Windows.Windows;
      expect(yield* windows.list).toEqual([{ id: 1, focused: true, incognito: false }]);
      expect(yield* windows.lastFocused).toEqual(
        Option.some({ id: 1, focused: true, incognito: false }),
      );
      expect(Option.map(yield* windows.current, (window) => window.id)).toEqual(Option.some(3));
      yield* windows.openPopup("/confirm.html", { width: 300, height: 200 });
      expect(fake.calls.filter((call) => call.api === "windows.create")).toEqual([
        {
          api: "windows.create",
          args: [
            {
              type: "popup",
              url: "moz-extension://synthetic/confirm.html",
              width: 300,
              height: 200,
            },
          ],
        },
      ]);
      yield* windows.remove(1);
      const error = yield* Effect.flip(windows.remove(2));
      expect(error).toMatchObject({ _tag: "BrowserError", api: "windows.remove" });

      expect(yield* (yield* Workspaces.Workspaces).current).toEqual(Option.none());
    }).pipe(Effect.provide(Live.layer));
  });

  it.effect("emits Tabs.changed for tab events that change the open tabs", () => {
    const fake = fakeBrowser();
    vi.stubGlobal("browser", fake.api);
    return Effect.gen(function* () {
      const tabs = yield* Tabs.Tabs;
      const fiber = yield* tabs.changed.pipe(Stream.take(7), Stream.runCollect, Effect.forkChild);
      yield* settle;
      const { onCreated, onRemoved, onMoved, onAttached, onReplaced, onUpdated } = fake.tabEvents;
      onCreated.emit({});
      onRemoved.emit(1, {});
      onMoved.emit(1, {});
      onAttached.emit(1, {});
      onReplaced.emit(2, 1);
      // Loading progress and audio changes don't change a snapshot.
      onUpdated.emit(1, { status: "loading" }, {});
      onUpdated.emit(1, { audible: true }, {});
      onUpdated.emit(1, { url: "https://example.com/b" }, {});
      onUpdated.emit(1, { title: "B" }, {});
      expect(yield* Fiber.join(fiber)).toHaveLength(7);
      const listeners = Object.values(fake.tabEvents).reduce((sum, e) => sum + e.size, 0);
      expect(listeners).toBe(0);
    }).pipe(Effect.provide(Live.layer));
  });

  it.effect("wraps browser.storage.local and its change events", () => {
    const fake = fakeBrowser();
    vi.stubGlobal("browser", fake.api);
    return Effect.gen(function* () {
      const storage = yield* Storage.Storage;
      expect(yield* storage.get("key")).toEqual(Option.none());
      const fiber = yield* storage.changes.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* settle;
      fake.onChanged.emit({ other: { newValue: 1 } }, "sync");
      yield* storage.set("key", { n: 1 });
      expect(yield* storage.get("key")).toEqual(Option.some({ n: 1 }));
      yield* storage.remove("key");
      expect(yield* Fiber.join(fiber)).toEqual([
        { key: "key", value: Option.some({ n: 1 }) },
        { key: "key", value: Option.none() },
      ]);
      expect(fake.onChanged.size).toBe(0);
    }).pipe(Effect.provide(Live.layer));
  });

  it.effect("wraps browser.alarms and browser.commands", () => {
    const fake = fakeBrowser();
    vi.stubGlobal("browser", fake.api);
    return Effect.gen(function* () {
      const alarms = yield* Alarms.Alarms;
      yield* alarms.create("sync", { periodInMinutes: 5 });
      expect(fake.calls).toContainEqual({
        api: "alarms.create",
        args: ["sync", { periodInMinutes: 5 }],
      });
      expect(yield* alarms.clear("sync")).toBe(true);
      expect(yield* alarms.list).toEqual([{ name: "sync", scheduledTime: 10, periodInMinutes: 5 }]);
      const fired = yield* alarms.fired.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
      yield* settle;
      fake.onAlarm.emit({ name: "once", scheduledTime: 20 });
      expect(yield* Fiber.join(fired)).toEqual([
        { name: "once", scheduledTime: 20, periodInMinutes: null },
      ]);

      const commands = yield* Commands.Commands;
      expect(yield* commands.list).toEqual([
        { name: "save-tab", description: "Save the current tab", shortcut: "Alt+Shift+S" },
        { name: "save-all", description: null, shortcut: null },
      ]);
      const triggered = yield* commands.triggered.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* settle;
      fake.onCommand.emit("save-tab");
      expect(yield* Fiber.join(triggered)).toEqual(["save-tab"]);
      expect(fake.onAlarm.size + fake.onCommand.size).toBe(0);
    }).pipe(Effect.provide(Live.layer));
  });

  it.effect("wraps browser.browserAction when there is no browser.action", () => {
    const fake = fakeBrowser();
    vi.stubGlobal("browser", fake.api);
    return Effect.gen(function* () {
      const action = yield* ToolbarAction.ToolbarAction;
      yield* action.setBadge({ text: "OK", color: "#2e7d32", title: "Saved" });
      yield* action.setBadge(null);
      expect(fake.calls.filter((call) => call.api.startsWith("browserAction."))).toEqual([
        { api: "browserAction.setBadgeText", args: [{ text: "OK" }] },
        { api: "browserAction.setBadgeBackgroundColor", args: [{ color: "#2e7d32" }] },
        { api: "browserAction.setTitle", args: [{ title: "Saved" }] },
        { api: "browserAction.setBadgeText", args: [{ text: "" }] },
        { api: "browserAction.setTitle", args: [{ title: null }] },
      ]);
      const clicked = yield* action.clicked.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* settle;
      fake.onClicked.emit({ id: 1 });
      expect(yield* Fiber.join(clicked)).toEqual([undefined]);
      expect(fake.onClicked.size).toBe(0);
    }).pipe(Effect.provide(Live.layer));
  });

  it.effect("calls the API with fetch and the stored config", () => {
    const fake = fakeBrowser();
    // Synthetic placeholder, not a real token.
    fake.local.set(ExtensionConfig.storageKey, {
      apiBaseUrl: "https://api.example.com",
      deviceToken: "synthetic-token",
    });
    vi.stubGlobal("browser", fake.api);
    const seen: Array<{ url: string; authorization: string | null }> = [];
    vi.stubGlobal("fetch", async (input: Request | URL | string, init?: RequestInit) => {
      const request = new Request(input, init);
      seen.push({ url: request.url, authorization: request.headers.get("authorization") });
      return Response.json({ kind: "device", deviceId: "device-1" });
    });
    return Effect.gen(function* () {
      const client = yield* StashApiClient.StashApiClient;
      expect(yield* client.auth.me()).toEqual({ kind: "device", deviceId: "device-1" });
      expect(seen).toEqual([
        { url: "https://api.example.com/auth/me", authorization: "Bearer synthetic-token" },
      ]);
    }).pipe(Effect.provide(Live.layer));
  });
});
