/**
 * Reports the open tabs to the API, so they show in "Open now" live.
 *
 * A snapshot is sent with `PUT /devices/:id/tabs` after tab events settle (debounced about 1.5 s,
 * so a burst of events is one snapshot), when the background page starts (the browser started),
 * on every firing of a slow repeating alarm (a safety net), and when the config changes on the
 * options page. A snapshot whose hash equals the last one sent is skipped, so nothing is sent
 * while nothing changed. A snapshot that fails (offline, a 429) is not queued: a one-shot retry
 * alarm takes a fresh one later, so only the latest state is ever sent. The hash is
 * kept in extension storage, so a suspended event page that wakes up again doesn't resend the
 * same tabs. When and how many tabs were last in step is kept there too (`lastSyncKey`), for the
 * options page.
 *
 * The device id is the one the token belongs to (`GET /auth/me`).
 */
import * as Alarms from "@stash/ext-platform/browser-alarms";
import * as Storage from "@stash/ext-platform/browser-storage";
import * as Tabs from "@stash/ext-platform/browser-tabs";
import * as ExtensionConfig from "@stash/ext-platform/extension-config";
import * as StashApiClient from "@stash/ext-platform/stash-api-client";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TabsSnapshot from "./tabs-snapshot.ts";

/** The repeating alarm that drives periodic snapshots. */
export const alarmName = "stash/tab-sync";

/** The `browser.storage.local` key that holds the hash of the last snapshot sent. */
export const lastHashKey = "stash/tab-sync/last-hash";

/** The one-shot alarm that retries after a failed sync. */
export const retryAlarmName = "stash/tab-sync/retry";

/** How long after a failed sync the retry alarm fires. Firefox clamps it to about 30 s. */
export const retryDelayInMinutes = 0.5;

/** The `browser.storage.local` key that holds when each open tab was first seen (`openedAtKey`). */
export const openedAtKey = "stash/tab-sync/opened-at";

// `[tab id, url, first seen]`. An entry of the older `[tab id, first seen]` form does not decode,
// so those tabs are seen anew once.
const OpenedAtEntries = Schema.Array(
  Schema.Tuple([Schema.Number, Schema.NullOr(Schema.String), Schema.Number]),
);
const decodeOpenedAt = Schema.decodeUnknownOption(OpenedAtEntries);

/** The `browser.storage.local` key that holds the `LastSync`. */
export const lastSyncKey = "stash/tab-sync/last-sync";

/** The last time Stash had this browser's open tabs: when (epoch ms) and how many. */
export const LastSync = Schema.Struct({ at: Schema.Number, tabs: Schema.Number });
export type LastSync = typeof LastSync.Type;

const decodeLastSync = Schema.decodeUnknownOption(LastSync);

/** The stored `LastSync`, or `None` before the first sync that went through. */
export const lastSync: Effect.Effect<
  Option.Option<LastSync>,
  never,
  Storage.Storage
> = Effect.flatMap(Storage.Storage, (storage) => storage.get(lastSyncKey)).pipe(
  Effect.map(Option.flatMap(decodeLastSync)),
  Effect.orElseSucceed(() => Option.none()),
);

export interface Options {
  /** How often a snapshot is taken without tab events. Default 5 minutes. */
  readonly periodInMinutes?: number;
  /** How long tab events must pause before a snapshot is taken. Default 1.5 seconds. */
  readonly debounce?: Duration.Input;
}

/** What one sync did. `skipped`: the snapshot equals the last one sent. */
export type Outcome = "posted" | "skipped";

/** Takes a snapshot and sends it, unless it equals the last one sent. */
export const sync = Effect.gen(function* () {
  const tabs = yield* Tabs.Tabs;
  const storage = yield* Storage.Storage;
  const client = yield* StashApiClient.StashApiClient;

  const now = yield* DateTime.now;
  const open = yield* tabs.query();
  // When each tab was first seen open, kept across event-page restarts. The api keeps the
  // earliest time of a url itself, so a lost record only makes a tab look younger once.
  const known: TabsSnapshot.OpenedAt = new Map(
    Option.getOrElse(
      Option.flatMap(
        yield* storage.get(openedAtKey).pipe(Effect.orElseSucceed(Option.none)),
        decodeOpenedAt,
      ),
      () => [],
    ).map(([id, url, at]) => [id, { url, at }] as const),
  );
  const openedAt = TabsSnapshot.trackOpened(known, open, DateTime.toEpochMillis(now));
  if (openedAt.size !== known.size || [...openedAt].some(([id, seen]) => known.get(id) !== seen)) {
    yield* storage.set(
      openedAtKey,
      [...openedAt].map(([id, seen]) => [id, seen.url, seen.at]),
    );
  }
  const openTabs = TabsSnapshot.fromTabs(open, now, openedAt);
  const hash = TabsSnapshot.hash(openTabs);
  // Stash has these tabs, whether this run sent them or an earlier one did.
  const inStep = storage.set(lastSyncKey, {
    at: DateTime.toEpochMillis(now),
    tabs: openTabs.length,
  } satisfies LastSync);
  if (Option.getOrUndefined(yield* storage.get(lastHashKey)) === hash) {
    yield* inStep;
    return "skipped" as Outcome;
  }

  const principal = yield* client.auth.me();
  if (principal.kind !== "device") {
    return yield* Effect.die(new Error("The API token does not belong to a device"));
  }
  yield* client.tabs.report({
    params: { id: principal.deviceId },
    payload: { takenAt: now, tabs: openTabs },
  });
  yield* storage.set(lastHashKey, hash);
  yield* inStep;
  return "posted" as Outcome;
});

/** Sends a snapshot now, also when it equals the last one sent ("Sync tabs now"). */
export const syncNow = Effect.flatMap(Storage.Storage, (storage) =>
  storage.remove(lastHashKey),
).pipe(Effect.andThen(sync));

// Logs only the error's tag (and the config reason), never its cause: a config that failed to
// decode carries the stored token in its cause.
const logFailure = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  if (error instanceof ExtensionConfig.ConfigError) {
    return Effect.logDebug("Tab sync skipped: no usable config").pipe(
      Effect.annotateLogs({ reason: error.reason }),
    );
  }
  const tag =
    typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : "Defect";
  return Effect.logWarning("Tab sync failed").pipe(Effect.annotateLogs({ error: tag }));
};

const run = (options: Options) =>
  Effect.gen(function* () {
    const alarms = yield* Alarms.Alarms;
    const tabs = yield* Tabs.Tabs;
    const storage = yield* Storage.Storage;

    // `create` replaces an existing alarm and restarts its period, so keep the one that is there.
    yield* alarms.list.pipe(
      Effect.flatMap((existing) =>
        existing.some((alarm) => alarm.name === alarmName)
          ? Effect.void
          : alarms.create(alarmName, { periodInMinutes: options.periodInMinutes ?? 5 }),
      ),
      Effect.catchCause(logFailure),
    );

    const triggers = Stream.mergeAll(
      [
        Stream.make("start" as const),
        alarms.fired.pipe(
          Stream.filter((alarm) => alarm.name === alarmName || alarm.name === retryAlarmName),
          Stream.as("alarm" as const),
        ),
        tabs.changed.pipe(
          Stream.debounce(options.debounce ?? "1500 millis"),
          Stream.as("tabs" as const),
        ),
        storage.changes.pipe(
          Stream.filter((change) => change.key === ExtensionConfig.storageKey),
          Stream.as("config" as const),
        ),
      ],
      { concurrency: "unbounded" },
    );

    // A failed sync (not a missing config) tries again on the retry alarm, with fresh tabs.
    const retryLater = (cause: Cause.Cause<unknown>) =>
      Cause.squash(cause) instanceof ExtensionConfig.ConfigError
        ? Effect.void
        : alarms
            .create(retryAlarmName, { delayInMinutes: retryDelayInMinutes })
            .pipe(Effect.ignore);

    // One sync at a time, in trigger order. A new token may belong to another device, so a
    // config change always sends.
    yield* Stream.runForEach(triggers, (trigger) =>
      (trigger === "config" ? storage.remove(lastHashKey) : Effect.void).pipe(
        Effect.andThen(sync),
        Effect.catchCause((cause) => Effect.andThen(logFailure(cause), retryLater(cause))),
      ),
    );
  });

/**
 * Runs tab sync in the background for as long as the layer lives. `apps/extension` merges it
 * into the background page's layer.
 */
export const layer = (
  options: Options = {},
): Layer.Layer<
  never,
  never,
  Alarms.Alarms | Tabs.Tabs | Storage.Storage | StashApiClient.StashApiClient
> => Layer.effectDiscard(Effect.forkScoped(run(options)));
