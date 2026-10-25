import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as ExtensionConfig from "./extension-config.ts";
import * as StashApiClient from "./stash-api-client.ts";
import { Alarms, type Alarm } from "./browser-alarms.ts";
import { BrowserError } from "./browser-error.ts";
import { Commands, type Command } from "./browser-commands.ts";
import { Storage, type StorageChange } from "./browser-storage.ts";
import { Tabs, type Tab, type TabsFilter } from "./browser-tabs.ts";
import { Windows } from "./browser-windows.ts";
import { Workspaces, type Workspace } from "./browser-workspaces.ts";
import type * as Live from "./live.ts";

// In-memory layers for every service in `./live`. Each build starts from its own state, so a test
// that provides a layer gets its own tabs, storage, alarms and so on.

/** A synthetic tab: only `id` is required, everything else has a plain default. */
export const tab = (fields: Partial<Tab> & { readonly id: number }): Tab => ({
  windowId: 1,
  url: `https://example.com/tabs/${fields.id}`,
  title: `Tab ${fields.id}`,
  active: false,
  pinned: false,
  hidden: false,
  lastAccessed: null,
  ...fields,
});

/** Test controls for the in-memory `Tabs` and `Windows`. */
export class TestTabs extends Context.Service<
  TestTabs,
  {
    /** Every open tab, in order. */
    readonly all: Effect.Effect<ReadonlyArray<Tab>>;
    /** Replaces the open tabs, as if the user opened or closed some. Emits `Tabs.changed`. */
    readonly set: (tabs: ReadonlyArray<Tab>) => Effect.Effect<void>;
    /** Focuses another window. */
    readonly focus: (windowId: number) => Effect.Effect<void>;
  }
>()("@stash/ext-platform/TestTabs") {}

const matches = (filter: TabsFilter, currentWindowId: number) => (tab: Tab) =>
  (filter.windowId === undefined || tab.windowId === filter.windowId) &&
  (filter.currentWindow === undefined ||
    (tab.windowId === currentWindowId) === filter.currentWindow) &&
  (filter.active === undefined || tab.active === filter.active) &&
  (filter.pinned === undefined || tab.pinned === filter.pinned) &&
  (filter.hidden === undefined || tab.hidden === filter.hidden);

/**
 * `Tabs` and `Windows` over one list of tabs. The windows are the distinct `windowId`s of the
 * tabs plus the focused one. `currentWindowId` defaults to the first tab's window (or `1`).
 */
export const layerTabs = (
  options: { readonly tabs?: ReadonlyArray<Tab>; readonly currentWindowId?: number } = {},
): Layer.Layer<Tabs | Windows | TestTabs> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const initial = options.tabs ?? [];
      const tabs = yield* Ref.make(initial);
      const changed = yield* PubSub.unbounded<void>();
      const setTabs = (value: ReadonlyArray<Tab>) =>
        Ref.set(tabs, value).pipe(Effect.andThen(PubSub.publish(changed, undefined)));
      const current = yield* Ref.make(options.currentWindowId ?? initial[0]?.windowId ?? 1);

      const query = (filter: TabsFilter = {}) =>
        Effect.map(Effect.all([Ref.get(tabs), Ref.get(current)]), ([all, windowId]) =>
          all.filter(matches(filter, windowId)),
        );
      const windowIds = Effect.map(Effect.all([Ref.get(tabs), Ref.get(current)]), ([all, id]) => [
        ...new Set([id, ...all.map((tab) => tab.windowId)]),
      ]);

      return Context.make(Tabs, {
        query,
        current: Effect.map(query({ active: true, currentWindow: true }), (found) =>
          Option.fromNullishOr(found[0]),
        ),
        remove: (ids) =>
          Effect.flatMap(Ref.get(tabs), (all) =>
            ids.every((id) => all.some((tab) => tab.id === id))
              ? setTabs(all.filter((tab) => !ids.includes(tab.id)))
              : Effect.fail(new BrowserError({ api: "tabs.remove", cause: "No such tab" })),
          ),
        changed: Stream.fromPubSub(changed),
      }).pipe(
        Context.add(Windows, {
          list: Effect.map(Effect.all([windowIds, Ref.get(current)]), ([ids, focused]) =>
            ids.map((id) => ({ id, focused: id === focused, incognito: false })),
          ),
          lastFocused: Effect.map(Ref.get(current), (id) =>
            Option.some({ id, focused: true, incognito: false }),
          ),
          remove: (id) =>
            Effect.flatMap(windowIds, (ids) =>
              ids.includes(id)
                ? Effect.flatMap(Ref.get(tabs), (all) =>
                    setTabs(all.filter((tab) => tab.windowId !== id)),
                  )
                : Effect.fail(new BrowserError({ api: "windows.remove", cause: "No such window" })),
            ),
        }),
        Context.add(TestTabs, {
          all: Ref.get(tabs),
          set: setTabs,
          focus: (windowId) => Ref.set(current, windowId),
        }),
      );
    }),
  );

/**
 * A `Map` behind `Storage`, seeded with `initial`. Values are copied with `structuredClone` on
 * the way in and out, like the browser serializes them.
 */
export const layerStorage = (
  options: { readonly initial?: Readonly<Record<string, unknown>> } = {},
): Layer.Layer<Storage> =>
  Layer.effect(Storage)(
    Effect.gen(function* () {
      const values = new Map(Object.entries(structuredClone(options.initial ?? {})));
      const changes = yield* PubSub.unbounded<StorageChange>();
      const publish = (key: string, value: Option.Option<unknown>) =>
        PubSub.publish(changes, { key, value: Option.map(value, structuredClone) });
      return {
        get: (key) =>
          Effect.sync(() =>
            values.has(key) ? Option.some(structuredClone(values.get(key))) : Option.none(),
          ),
        set: (key, value) =>
          Effect.suspend(() => {
            values.set(key, structuredClone(value));
            return publish(key, Option.some(value));
          }),
        remove: (key) =>
          Effect.suspend(() => (values.delete(key) ? publish(key, Option.none()) : Effect.void)),
        changes: Stream.fromPubSub(changes),
      };
    }),
  );

/** Test controls for the in-memory `Alarms`. */
export class TestAlarms extends Context.Service<
  TestAlarms,
  {
    /**
     * Fires the alarm now, if it exists. A one-shot alarm is removed, as in the browser.
     * `false` if no alarm has that name.
     */
    readonly fire: (name: string) => Effect.Effect<boolean>;
  }
>()("@stash/ext-platform/TestAlarms") {}

/** Alarms never fire by themselves. Fire them with `TestAlarms.fire`. */
export const layerAlarms: Layer.Layer<Alarms | TestAlarms> = Layer.effectContext(
  Effect.gen(function* () {
    const alarms = yield* Ref.make<ReadonlyMap<string, Alarm>>(new Map());
    const fired = yield* PubSub.unbounded<Alarm>();
    return Context.make(Alarms, {
      create: (name, schedule) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) => {
          const minutes = schedule.delayInMinutes ?? schedule.periodInMinutes ?? 0;
          const alarm: Alarm = {
            name,
            scheduledTime: now + minutes * 60_000,
            periodInMinutes: schedule.periodInMinutes ?? null,
          };
          return Ref.update(alarms, (all) => new Map(all).set(name, alarm));
        }),
      clear: (name) =>
        Ref.modify(alarms, (all) => {
          const next = new Map(all);
          return [next.delete(name), next];
        }),
      list: Effect.map(Ref.get(alarms), (all) => [...all.values()]),
      fired: Stream.fromPubSub(fired),
    }).pipe(
      Context.add(TestAlarms, {
        fire: (name) =>
          Effect.flatMap(Ref.get(alarms), (all) => {
            const alarm = all.get(name);
            if (alarm === undefined) return Effect.succeed(false);
            const next = new Map(all);
            if (alarm.periodInMinutes === null) next.delete(name);
            return Ref.set(alarms, next).pipe(
              Effect.andThen(PubSub.publish(fired, alarm)),
              Effect.as(true),
            );
          }),
      }),
    );
  }),
);

/** Test controls for the in-memory `Commands`. */
export class TestCommands extends Context.Service<
  TestCommands,
  { readonly trigger: (name: string) => Effect.Effect<void> }
>()("@stash/ext-platform/TestCommands") {}

/** Lists `commands`. Trigger one with `TestCommands.trigger`. */
export const layerCommands = (
  commands: ReadonlyArray<Command> = [],
): Layer.Layer<Commands | TestCommands> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const triggered = yield* PubSub.unbounded<string>();
      return Context.make(Commands, {
        list: Effect.succeed(commands),
        triggered: Stream.fromPubSub(triggered),
      }).pipe(
        Context.add(TestCommands, {
          trigger: (name) => Effect.asVoid(PubSub.publish(triggered, name)),
        }),
      );
    }),
  );

/** Test controls for the in-memory `Workspaces`. */
export class TestWorkspaces extends Context.Service<
  TestWorkspaces,
  {
    /** Switches to `workspace` with its tabs, or to no workspace with `None`. */
    readonly switchTo: (
      workspace: Option.Option<Workspace>,
      tabIds?: ReadonlyArray<number>,
    ) => Effect.Effect<void>;
  }
>()("@stash/ext-platform/TestWorkspaces") {}

/**
 * Starts without a workspace, like the live layer, unless `current` is given. `tabIds` are the
 * tabs in `current`.
 */
export const layerWorkspaces = (
  options: { readonly current?: Workspace; readonly tabIds?: ReadonlyArray<number> } = {},
): Layer.Layer<Workspaces | TestWorkspaces> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const state = yield* Ref.make({
        current: Option.fromUndefinedOr(options.current),
        tabIds: options.tabIds ?? [],
      });
      return Context.make(Workspaces, {
        current: Effect.map(Ref.get(state), ({ current }) => current),
        tabIds: (workspace) =>
          Effect.map(Ref.get(state), ({ current, tabIds }) =>
            Option.exists(current, (it) => it.id === workspace.id) ? tabIds : [],
          ),
      }).pipe(
        Context.add(TestWorkspaces, {
          switchTo: (current, tabIds = []) => Ref.set(state, { current, tabIds }),
        }),
      );
    }),
  );

/** Answers every request with `handler`. By default every request gets a 404. */
export const layerHttpClient = (
  handler: (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<Response> = () =>
    Effect.succeed(new Response(null, { status: 404 })),
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) =>
      Effect.map(handler(request), (response) => HttpClientResponse.fromWeb(request, response)),
    ),
  );

/** The stored form of a config, to seed `layerStorage` or `make`. Use synthetic values only. */
export interface StoredConfig {
  readonly apiBaseUrl: string;
  readonly deviceToken: string;
}

/** Options for `make`. Each one seeds the in-memory service it names. */
export interface Options {
  readonly tabs?: ReadonlyArray<Tab>;
  readonly currentWindowId?: number;
  /** Saved as if entered on the options page. Without it, `ExtensionConfig.get` fails. */
  readonly config?: StoredConfig;
  readonly storage?: Readonly<Record<string, unknown>>;
  readonly commands?: ReadonlyArray<Command>;
  readonly workspace?: Workspace;
  readonly workspaceTabIds?: ReadonlyArray<number>;
  /** Answers the requests `StashApiClient` sends. */
  readonly handler?: (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<Response>;
}

/** Every service from `./live`, in memory, plus the test controls. */
export const make = (
  options: Options = {},
): Layer.Layer<Live.Services | TestTabs | TestAlarms | TestCommands | TestWorkspaces> => {
  const tabsOptions: { tabs?: ReadonlyArray<Tab>; currentWindowId?: number } = {};
  if (options.tabs !== undefined) tabsOptions.tabs = options.tabs;
  if (options.currentWindowId !== undefined) tabsOptions.currentWindowId = options.currentWindowId;
  const workspaceOptions: { current?: Workspace; tabIds?: ReadonlyArray<number> } = {};
  if (options.workspace !== undefined) workspaceOptions.current = options.workspace;
  if (options.workspaceTabIds !== undefined) workspaceOptions.tabIds = options.workspaceTabIds;
  const storage = layerStorage({
    initial: {
      ...options.storage,
      ...(options.config === undefined ? {} : { [ExtensionConfig.storageKey]: options.config }),
    },
  });
  return StashApiClient.layer.pipe(
    Layer.provideMerge(ExtensionConfig.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        layerTabs(tabsOptions),
        storage,
        layerAlarms,
        layerCommands(options.commands),
        layerWorkspaces(workspaceOptions),
        layerHttpClient(options.handler),
      ),
    ),
  );
};

/** `make()`: no tabs, empty storage, no config, every request 404. */
export const layer: Layer.Layer<
  Live.Services | TestTabs | TestAlarms | TestCommands | TestWorkspaces
> = make();
