import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
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
  };
  return { api, calls, local, onChanged, onAlarm, onCommand };
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
      expect(fake.calls.filter((call) => call.api.startsWith("tabs."))).toEqual([
        { api: "tabs.query", args: [{ currentWindow: true, pinned: true }] },
        { api: "tabs.query", args: [{ currentWindow: true, active: true }] },
        { api: "tabs.remove", args: [[1, 2]] },
      ]);

      const windows = yield* Windows.Windows;
      expect(yield* windows.list).toEqual([{ id: 1, focused: true, incognito: false }]);
      expect(yield* windows.lastFocused).toEqual(
        Option.some({ id: 1, focused: true, incognito: false }),
      );
      yield* windows.remove(1);
      const error = yield* Effect.flip(windows.remove(2));
      expect(error).toMatchObject({ _tag: "BrowserError", api: "windows.remove" });

      expect(yield* (yield* Workspaces.Workspaces).current).toEqual(Option.none());
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
