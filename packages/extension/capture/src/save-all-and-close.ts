import * as LinksGroup from "@stash/contracts-api/links";
import type * as Link from "@stash/contracts-domain/link";
import type { BrowserError } from "@stash/ext-platform/browser-error";
import * as Commands from "@stash/ext-platform/browser-commands";
import * as Storage from "@stash/ext-platform/browser-storage";
import * as Tabs from "@stash/ext-platform/browser-tabs";
import * as Windows from "@stash/ext-platform/browser-windows";
import * as Workspaces from "@stash/ext-platform/browser-workspaces";
import * as StashApiClient from "@stash/ext-platform/stash-api-client";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SaveCurrentTab from "./save-current-tab.ts";
import * as SaveLink from "./save-link.ts";

/** The keyboard command in the manifest (`commands`) that asks to save all tabs and close them. */
export const commandName = "save-all-and-close";

/** The `browser.storage.local` key that hands the target from the command to the popup. */
export const targetStorageKey = "stash/capture/save-all-and-close";

/** The size of the confirmation popup window. */
export const popupSize = { width: 400, height: 320 } as const;

/**
 * Which tabs to save: the visible tabs of a window or, when the browser can tell, the tabs of the
 * Zen workspace shown in it. Zen hides the tabs of the other workspaces, so the visible tabs of a
 * window are the current workspace even without a workspace API.
 */
export const Target = Schema.Struct({
  windowId: Schema.Int,
  workspace: Schema.optionalKey(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
export type Target = typeof Target.Type;

const decodeTarget = Schema.decodeUnknownOption(Target);

/** A tab to save and close, with what to save for it. */
export interface Entry {
  readonly tab: Tabs.Tab;
  readonly input: Link.SaveLinkInput;
}

/** What "Save all & close" would do with the tabs of a target. */
export interface Plan {
  readonly target: Target;
  readonly entries: ReadonlyArray<Entry>;
  /** Pinned tabs and pages that are not http(s): never sent, left open. */
  readonly skipped: ReadonlyArray<Tabs.Tab>;
}

/**
 * Why some tabs stayed open:
 * - `RateLimited` / `Offline` / `NeedsSetup` / `Rejected`: a batch was not saved (see
 *   `SaveLink.Result`). Nothing is queued: the tabs stay open, so asking again retries them.
 * - `CloseFailed`: the links are saved, but the browser did not close the tabs.
 */
export type Problem = "RateLimited" | "Offline" | "NeedsSetup" | "Rejected" | "CloseFailed";

export interface Outcome {
  /** Tabs saved and closed. */
  readonly closed: number;
  /** Tabs to save that stay open because their link was not confirmed saved. */
  readonly kept: number;
  /** Pinned and non-http(s) tabs, left open. */
  readonly skipped: number;
  readonly problem: Problem | null;
}

/** The tabs of `target`, split into the ones to save and the ones to skip. */
export const plan = (
  target: Target,
): Effect.Effect<Plan, BrowserError, Tabs.Tabs | Workspaces.Workspaces> =>
  Effect.gen(function* () {
    const tabs = yield* Tabs.Tabs;
    const all = yield* Option.match(Option.fromUndefinedOr(target.workspace), {
      onNone: () => tabs.query({ windowId: target.windowId, hidden: false }),
      onSome: (workspace) =>
        Effect.gen(function* () {
          const ids = new Set(yield* (yield* Workspaces.Workspaces).tabIds(workspace));
          const inWindow = yield* tabs.query({ windowId: target.windowId });
          return inWindow.filter((tab) => ids.has(tab.id));
        }),
    });
    const entries: Array<Entry> = [];
    const skipped: Array<Tabs.Tab> = [];
    for (const tab of all) {
      const input = tab.pinned ? Option.none() : SaveCurrentTab.toInput(tab);
      if (Option.isSome(input)) entries.push({ tab, input: input.value });
      else skipped.push(tab);
    }
    return { target, entries, skipped };
  });

/** One input per URL, the first tab's title wins, in batches the API accepts. */
const batches = (
  entries: ReadonlyArray<Entry>,
): ReadonlyArray<ReadonlyArray<Link.SaveLinkInput>> => {
  const unique = entries
    .map((entry) => entry.input)
    .filter((input, index, all) => all.findIndex((it) => it.url === input.url) === index);
  const result: Array<ReadonlyArray<Link.SaveLinkInput>> = [];
  for (let start = 0; start < unique.length; start += LinksGroup.maxBatchSize)
    result.push(unique.slice(start, start + LinksGroup.maxBatchSize));
  return result;
};

/**
 * Saves the links of `plan` with `POST /links/batch`, then closes only the tabs whose URL came
 * back saved. A failed batch leaves its tabs open, and the batches after a failure that won't
 * pass now (rate limited, offline, needs setup) are not sent. If nothing of the target would be
 * left, a blank tab is opened first, so the window or workspace stays.
 */
export const run = (
  plan: Plan,
): Effect.Effect<Outcome, never, Tabs.Tabs | StashApiClient.StashApiClient> =>
  Effect.gen(function* () {
    const client = yield* StashApiClient.StashApiClient;
    const tabs = yield* Tabs.Tabs;
    const saved = new Set<string>();
    let problem: Problem | null = null;

    for (const links of batches(plan.entries)) {
      const result = yield* client.links.saveBatch({ payload: { links } }).pipe(
        Effect.map((response) => ({ _tag: "Saved", links: response.links }) as const),
        Effect.catch((error) =>
          Effect.as(
            Effect.logWarning("capture: POST /links/batch failed", error._tag),
            SaveLink.classify(error),
          ),
        ),
      );
      if (result._tag === "Saved") {
        for (const link of result.links) saved.add(link.url);
        continue;
      }
      problem = result._tag === "Retry" ? result.reason : result._tag;
      if (result._tag !== "Rejected") break;
    }

    const confirmed = plan.entries.filter((entry) => saved.has(entry.input.url));
    const closed = yield* Effect.gen(function* () {
      if (confirmed.length === 0) return 0;
      // Tabs the user closed in the meantime would make `remove` fail.
      const open = new Set(
        (yield* tabs.query({ windowId: plan.target.windowId })).map((t) => t.id),
      );
      const ids = confirmed.map((entry) => entry.tab.id).filter((id) => open.has(id));
      if (plan.skipped.length === 0 && confirmed.length === plan.entries.length)
        yield* tabs.createBlank(plan.target.windowId);
      yield* tabs.remove(ids);
      return ids.length;
    }).pipe(
      Effect.catchTag("BrowserError", (error) =>
        Effect.as(Effect.logWarning("capture: closing saved tabs failed", error.api), null),
      ),
    );

    return {
      closed: closed ?? 0,
      kept: plan.entries.length - confirmed.length,
      skipped: plan.skipped.length,
      problem: closed === null ? "CloseFailed" : problem,
    };
  });

const storedTarget = Effect.flatMap(Storage.Storage, (storage) =>
  Effect.map(storage.get(targetStorageKey), Option.flatMap(decodeTarget)),
);

/** For the popup: the plan for the target the command stored, `None` when there is none. */
export const pending: Effect.Effect<
  Option.Option<Plan>,
  BrowserError,
  Storage.Storage | Tabs.Tabs | Workspaces.Workspaces
> = Effect.flatMap(storedTarget, (target) =>
  Option.match(target, {
    onNone: () => Effect.succeedNone,
    onSome: (it) => Effect.map(plan(it), Option.some),
  }),
);

/**
 * For the popup, once the user confirms: plans the stored target again (tabs may have changed
 * since the popup opened), runs it and forgets the target. `None` when there is no target.
 */
export const confirm: Effect.Effect<
  Option.Option<Outcome>,
  BrowserError,
  Storage.Storage | Tabs.Tabs | Workspaces.Workspaces | StashApiClient.StashApiClient
> = Effect.gen(function* () {
  const current = yield* pending;
  if (Option.isNone(current)) return Option.none();
  yield* (yield* Storage.Storage).remove(targetStorageKey);
  return Option.some(yield* run(current.value));
});

/** For the popup: forgets the target and closes the popup window. */
export const dismiss: Effect.Effect<void, BrowserError, Storage.Storage | Windows.Windows> =
  Effect.gen(function* () {
    yield* (yield* Storage.Storage).remove(targetStorageKey);
    const windows = yield* Windows.Windows;
    const popup = yield* windows.current;
    if (Option.isSome(popup)) yield* windows.remove(popup.value.id);
  });

/**
 * The background side: the `save-all-and-close` command stores the target (the last focused
 * window and its workspace) and opens `confirmPage`, an extension page that asks before anything
 * is saved or closed, in a popup window.
 */
export const layer = (options: {
  readonly confirmPage: string;
}): Layer.Layer<
  never,
  never,
  Commands.Commands | Windows.Windows | Workspaces.Workspaces | Storage.Storage
> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const commands = yield* Commands.Commands;
      const windows = yield* Windows.Windows;
      const workspaces = yield* Workspaces.Workspaces;
      const storage = yield* Storage.Storage;

      const ask = Effect.gen(function* () {
        const window = yield* windows.lastFocused;
        if (Option.isNone(window)) return;
        const workspace = yield* workspaces.current;
        const target: Target = Option.match(workspace, {
          onNone: () => ({ windowId: window.value.id }),
          onSome: (it) => ({ windowId: window.value.id, workspace: { id: it.id, name: it.name } }),
        });
        yield* storage.set(targetStorageKey, target);
        yield* windows.openPopup(options.confirmPage, popupSize);
      }).pipe(Effect.ignore({ log: "Warn" }));

      // Started at once, so the listener is in place before the page's first `await`.
      yield* Effect.forkScoped(
        Stream.runForEach(
          Stream.filter(commands.triggered, (name) => name === commandName),
          () => ask,
        ),
        { startImmediately: true },
      );
    }),
  );
