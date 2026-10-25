import * as Link from "@stash/contracts-domain/link";
import * as ToolbarAction from "@stash/ext-platform/browser-action";
import * as Alarms from "@stash/ext-platform/browser-alarms";
import * as Commands from "@stash/ext-platform/browser-commands";
import * as Storage from "@stash/ext-platform/browser-storage";
import * as Tabs from "@stash/ext-platform/browser-tabs";
import * as ExtensionConfig from "@stash/ext-platform/extension-config";
import type * as StashApiClient from "@stash/ext-platform/stash-api-client";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as CaptureBadge from "./capture-badge.ts";
import * as RetryQueue from "./retry-queue.ts";
import * as SaveLink from "./save-link.ts";

/** The keyboard command in the manifest (`commands`) that saves the current tab. */
export const commandName = "save-current-tab";

const decodeUrl = Schema.decodeUnknownOption(Link.Url);
const decodeTitle = Schema.decodeUnknownOption(Link.LinkTitle);

/** What to save for `tab`: its http(s) URL and, when it has one, its title. */
export const toInput = (tab: Tabs.Tab): Option.Option<Link.SaveLinkInput> =>
  Option.map(decodeUrl(tab.url), (url) =>
    Option.match(decodeTitle(tab.title?.trim().slice(0, 1000)), {
      onNone: () => ({ url }),
      onSome: (title) => ({ url, title }),
    }),
  );

/**
 * Saves the active tab of the current window with `POST /links`. When the API can't take it now
 * (offline, rate limited, no working token yet), the link goes to the retry queue.
 */
export const saveCurrentTab = (
  queue: RetryQueue.RetryQueue,
): Effect.Effect<CaptureBadge.State, never, Tabs.Tabs | StashApiClient.StashApiClient> =>
  Effect.gen(function* () {
    const tabs = yield* Tabs.Tabs;
    const input = Option.flatMap(yield* tabs.current, toInput);
    if (Option.isNone(input)) return { _tag: "Unsupported" } as const;
    const result = yield* SaveLink.save(input.value);
    switch (result._tag) {
      case "Saved":
        return { _tag: "Saved" } as const;
      case "Rejected":
        return { _tag: "Failed" } as const;
      case "NeedsSetup":
        yield* queue.add(input.value);
        return { _tag: "NeedsSetup" } as const;
      case "Retry":
        yield* queue.add(input.value);
        yield* queue.schedule(result.afterSeconds);
        return { _tag: result.reason, retryInSeconds: result.afterSeconds } as const;
    }
  }).pipe(
    Effect.catchTag("BrowserError", (error) =>
      Effect.as(Effect.logWarning("capture: browser call failed", error.api), {
        _tag: "Failed",
      } as const),
    ),
  );

/**
 * The capture feature for the background page: the `save-current-tab` command and a click on the
 * toolbar button save the current tab and show the result as a badge. Queued links are sent when
 * the retry alarm fires, when the page starts, after a successful save and when the config
 * changes on the options page.
 */
export const layer: Layer.Layer<
  never,
  never,
  | Tabs.Tabs
  | Storage.Storage
  | Alarms.Alarms
  | Commands.Commands
  | ToolbarAction.ToolbarAction
  | StashApiClient.StashApiClient
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const queue = yield* RetryQueue.make;
    const badge = yield* CaptureBadge.make;
    const commands = yield* Commands.Commands;
    const action = yield* ToolbarAction.ToolbarAction;
    const alarms = yield* Alarms.Alarms;
    const storage = yield* Storage.Storage;

    const flush = queue.flush.pipe(Effect.ignore({ log: "Warn" }));
    // Saves run one after another, in the order asked for.
    const lock = yield* Semaphore.make(1);
    const save = lock.withPermit(
      Effect.gen(function* () {
        yield* badge.show({ _tag: "Saving" });
        const state = yield* saveCurrentTab(queue);
        yield* badge.show(state);
        if (state._tag === "Saved") yield* flush;
      }),
    );

    // Each source in its own fiber, started at once: the listeners are in place before the layer
    // is built, so the browser sees them before the page's first `await`. (`Stream.merge` would
    // subscribe later, in forked fibers, and miss an event that arrives first.)
    const listen = <A, R>(events: Stream.Stream<A>, run: Effect.Effect<void, never, R>) =>
      Effect.forkScoped(
        Stream.runForEach(events, () => run),
        { startImmediately: true },
      );
    yield* listen(
      Stream.filter(commands.triggered, (name) => name === commandName),
      save,
    );
    yield* listen(action.clicked, save);
    yield* listen(
      Stream.filter(alarms.fired, (alarm) => alarm.name === RetryQueue.alarmName),
      flush,
    );
    yield* listen(
      Stream.filter(storage.changes, (change) => change.key === ExtensionConfig.storageKey),
      flush,
    );
    // Links queued before the page (re)started.
    yield* Effect.forkScoped(flush, { startImmediately: true });
  }),
);
