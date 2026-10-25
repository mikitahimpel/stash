import { describe, expect, it } from "@effect/vitest";
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
import * as Testing from "../src/testing.ts";

// Lets a forked stream subscribe before the test changes state.
const settle = Effect.repeat(Effect.yieldNow, { times: 10 });

const tabs = [
  Testing.tab({ id: 1, windowId: 1, active: true }),
  Testing.tab({ id: 2, windowId: 1, pinned: true }),
  Testing.tab({ id: 3, windowId: 2, active: true }),
];

describe("testing layers", () => {
  it.effect("Tabs filters and removes the synthetic tabs", () =>
    Effect.gen(function* () {
      const service = yield* Tabs.Tabs;
      expect((yield* service.query()).map((tab) => tab.id)).toEqual([1, 2, 3]);
      expect((yield* service.query({ currentWindow: true })).map((tab) => tab.id)).toEqual([1, 2]);
      expect((yield* service.query({ pinned: true })).map((tab) => tab.id)).toEqual([2]);
      expect(Option.map(yield* service.current, (tab) => tab.id)).toEqual(Option.some(1));

      yield* (yield* Testing.TestTabs).focus(2);
      expect(Option.map(yield* service.current, (tab) => tab.id)).toEqual(Option.some(3));

      yield* service.remove([1, 3]);
      expect((yield* (yield* Testing.TestTabs).all).map((tab) => tab.id)).toEqual([2]);
      const error = yield* Effect.flip(service.remove([99]));
      expect(error.api).toBe("tabs.remove");
    }).pipe(Effect.provide(Testing.layerTabs({ tabs }))),
  );

  it.effect("Tabs.changed emits when the tabs are set or closed", () =>
    Effect.gen(function* () {
      const service = yield* Tabs.Tabs;
      const fiber = yield* service.changed.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* settle;
      yield* (yield* Testing.TestTabs).set([...tabs, Testing.tab({ id: 4 })]);
      yield* service.remove([4]);
      yield* (yield* Windows.Windows).remove(2);
      expect(yield* Fiber.join(fiber)).toHaveLength(3);
    }).pipe(Effect.provide(Testing.layerTabs({ tabs }))),
  );

  it.effect("Windows follows the tabs and closes a window with its tabs", () =>
    Effect.gen(function* () {
      const windows = yield* Windows.Windows;
      expect(yield* windows.list).toEqual([
        { id: 1, focused: true, incognito: false },
        { id: 2, focused: false, incognito: false },
      ]);
      expect(Option.map(yield* windows.lastFocused, (window) => window.id)).toEqual(Option.some(1));
      yield* windows.remove(2);
      expect((yield* (yield* Tabs.Tabs).query()).map((tab) => tab.id)).toEqual([1, 2]);
      expect((yield* Effect.flip(windows.remove(7))).api).toBe("windows.remove");
    }).pipe(Effect.provide(Testing.layerTabs({ tabs }))),
  );

  it.effect("Storage keeps copies of the values and reports changes", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Storage;
      expect(yield* storage.get("seeded")).toEqual(Option.some({ count: 1 }));
      expect(yield* storage.get("missing")).toEqual(Option.none());

      const fiber = yield* storage.changes.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* settle;
      const value = { list: ["a"] };
      yield* storage.set("key", value);
      value.list.push("b");
      expect(yield* storage.get("key")).toEqual(Option.some({ list: ["a"] }));
      yield* storage.remove("key");
      yield* storage.remove("key");
      expect(yield* Fiber.join(fiber)).toEqual([
        { key: "key", value: Option.some({ list: ["a"] }) },
        { key: "key", value: Option.none() },
      ]);
    }).pipe(Effect.provide(Testing.layerStorage({ initial: { seeded: { count: 1 } } }))),
  );

  it.effect("Alarms fire only when the test fires them", () =>
    Effect.gen(function* () {
      const alarms = yield* Alarms.Alarms;
      const control = yield* Testing.TestAlarms;
      yield* alarms.create("sync", { periodInMinutes: 5 });
      yield* alarms.create("once", { delayInMinutes: 1 });
      expect((yield* alarms.list).map((alarm) => alarm.name)).toEqual(["sync", "once"]);

      const fiber = yield* alarms.fired.pipe(Stream.take(3), Stream.runCollect, Effect.forkChild);
      yield* settle;
      expect(yield* control.fire("sync")).toBe(true);
      expect(yield* control.fire("once")).toBe(true);
      expect(yield* control.fire("once")).toBe(false);
      expect(yield* control.fire("sync")).toBe(true);
      const fired = yield* Fiber.join(fiber);
      expect(fired.map((alarm) => alarm.name)).toEqual(["sync", "once", "sync"]);
      expect(fired[0]?.periodInMinutes).toBe(5);

      expect(yield* alarms.clear("sync")).toBe(true);
      expect(yield* alarms.clear("sync")).toBe(false);
      expect(yield* alarms.list).toEqual([]);
    }).pipe(Effect.provide(Testing.layerAlarms)),
  );

  it.effect("Commands lists the commands and emits triggered ones", () =>
    Effect.gen(function* () {
      const commands = yield* Commands.Commands;
      expect(yield* commands.list).toEqual([
        { name: "save-tab", description: "Save the current tab", shortcut: "Alt+Shift+S" },
      ]);
      const fiber = yield* commands.triggered.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* settle;
      yield* (yield* Testing.TestCommands).trigger("save-tab");
      expect(yield* Fiber.join(fiber)).toEqual(["save-tab"]);
    }).pipe(
      Effect.provide(
        Testing.layerCommands([
          { name: "save-tab", description: "Save the current tab", shortcut: "Alt+Shift+S" },
        ]),
      ),
    ),
  );

  it.effect("Workspaces starts empty and switches on demand", () =>
    Effect.gen(function* () {
      const workspaces = yield* Workspaces.Workspaces;
      expect(yield* workspaces.current).toEqual(Option.none());
      const research = { id: "ws-1", name: "Research" };
      yield* (yield* Testing.TestWorkspaces).switchTo(Option.some(research), [1, 2]);
      expect(yield* workspaces.current).toEqual(Option.some(research));
      expect(yield* workspaces.tabIds(research)).toEqual([1, 2]);
      expect(yield* workspaces.tabIds({ id: "ws-2", name: "Other" })).toEqual([]);
    }).pipe(Effect.provide(Testing.layerWorkspaces())),
  );

  it.effect("ToolbarAction records badges and emits clicks", () =>
    Effect.gen(function* () {
      const action = yield* ToolbarAction.ToolbarAction;
      const test = yield* Testing.TestToolbarAction;
      expect(yield* test.badge).toEqual(Option.none());
      const saved = { text: "OK", color: "#2e7d32", title: null };
      yield* action.setBadge(saved);
      expect(yield* test.badge).toEqual(Option.some(saved));
      yield* action.setBadge(null);
      expect(yield* test.badge).toEqual(Option.none());
      expect(yield* test.history).toEqual([saved, null]);
      const fiber = yield* action.clicked.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
      yield* settle;
      yield* test.click;
      expect(yield* Fiber.join(fiber)).toEqual([undefined]);
    }).pipe(Effect.provide(Testing.layerToolbarAction)),
  );
});
