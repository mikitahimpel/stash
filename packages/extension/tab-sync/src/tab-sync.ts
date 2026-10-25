/**
 * Reports the open tabs to the API, so they show in "Open now".
 *
 * A snapshot is sent with `PUT /devices/:id/tabs` when the background page starts, on every
 * firing of a repeating alarm, after tab events settle (debounced), and when the config changes
 * on the options page. A snapshot whose hash equals the last one sent is skipped. The hash is
 * kept in extension storage, so a suspended event page that wakes up again doesn't resend the
 * same tabs.
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
import * as Stream from "effect/Stream";
import * as TabsSnapshot from "./tabs-snapshot.ts";

/** The repeating alarm that drives periodic snapshots. */
export const alarmName = "stash/tab-sync";

/** The `browser.storage.local` key that holds the hash of the last snapshot sent. */
export const lastHashKey = "stash/tab-sync/last-hash";

export interface Options {
  /** How often a snapshot is taken without tab events. Default 5 minutes. */
  readonly periodInMinutes?: number;
  /** How long tab events must pause before a snapshot is taken. Default 2 seconds. */
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
  const openTabs = TabsSnapshot.fromTabs(yield* tabs.query(), now);
  const hash = TabsSnapshot.hash(openTabs);
  if (Option.getOrUndefined(yield* storage.get(lastHashKey)) === hash) return "skipped" as Outcome;

  const principal = yield* client.auth.me();
  if (principal.kind !== "device") {
    return yield* Effect.die(new Error("The API token does not belong to a device"));
  }
  yield* client.tabs.report({
    params: { id: principal.deviceId },
    payload: { takenAt: now, tabs: openTabs },
  });
  yield* storage.set(lastHashKey, hash);
  return "posted" as Outcome;
});

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
          Stream.filter((alarm) => alarm.name === alarmName),
          Stream.as("alarm" as const),
        ),
        tabs.changed.pipe(
          Stream.debounce(options.debounce ?? "2 seconds"),
          Stream.as("tabs" as const),
        ),
        storage.changes.pipe(
          Stream.filter((change) => change.key === ExtensionConfig.storageKey),
          Stream.as("config" as const),
        ),
      ],
      { concurrency: "unbounded" },
    );

    // One sync at a time, in trigger order. A new token may belong to another device, so a
    // config change always sends.
    yield* Stream.runForEach(triggers, (trigger) =>
      (trigger === "config" ? storage.remove(lastHashKey) : Effect.void).pipe(
        Effect.andThen(sync),
        Effect.catchCause(logFailure),
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
