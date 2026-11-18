import * as ExtensionConfig from "@stash/ext-platform/extension-config";
import * as Storage from "@stash/ext-platform/browser-storage";
import * as StashApiClient from "@stash/ext-platform/stash-api-client";
import * as TabSync from "@stash/ext-tab-sync/tab-sync";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/** The latest link this browser saved, as Stash has it (`GET /devices/activity`). */
export interface LastSave {
  /** The link's title, or its URL when it has none. */
  readonly title: string;
  /** Epoch milliseconds. */
  readonly at: number;
}

/**
 * What the options page shows:
 * - `NotPaired`: no device token, or the api rejected it. `webOrigin` is the Stash to connect to:
 *   the one the rejected token was for, else the one built into the extension, else `""`.
 * - `Paired`: the api answered. `deviceName` is `null` for a token that belongs to no device.
 * - `Unreachable`: there is a token, but the api did not answer.
 */
export type View =
  | { readonly _tag: "NotPaired"; readonly webOrigin: string }
  | {
      readonly _tag: "Paired";
      readonly webOrigin: string;
      readonly deviceName: string | null;
      readonly lastSave: LastSave | null;
      readonly tabSync: TabSync.LastSync | null;
    }
  | { readonly _tag: "Unreachable"; readonly webOrigin: string };

// The device's name and its last save. Neither is worth an error: what is missing is left out.
const device = Effect.fnUntraced(function* (deviceId: string) {
  const client = yield* StashApiClient.StashApiClient;
  const [devices, activity] = yield* Effect.all(
    [
      client.devices.list().pipe(Effect.orElseSucceed(() => [])),
      client.devices.activity().pipe(Effect.orElseSucceed(() => [])),
    ],
    { concurrency: "unbounded" },
  );
  const lastSave = activity.find((it) => it.deviceId === deviceId)?.lastSave ?? null;
  return {
    deviceName: devices.find((it) => it.id === deviceId)?.name ?? null,
    lastSave:
      lastSave === null
        ? null
        : { title: lastSave.title ?? lastSave.url, at: DateTime.toEpochMillis(lastSave.at) },
  };
});

/**
 * The state of the connection, checked with `GET /auth/me`. Never fails. `builtInOrigin` is the
 * Stash this build belongs to (`build-origin.ts`), `""` when it has none.
 */
export const load = (
  builtInOrigin: string,
): Effect.Effect<
  View,
  never,
  ExtensionConfig.ExtensionConfig | StashApiClient.StashApiClient | Storage.Storage
> =>
  Effect.gen(function* () {
    const config = yield* (yield* ExtensionConfig.ExtensionConfig).get;
    // The api is served under `/api` of the web app, so the web origin is the api's origin.
    const webOrigin = config.apiBaseUrl.origin;
    const client = yield* StashApiClient.StashApiClient;
    return yield* Effect.gen(function* () {
      const principal = yield* client.auth.me();
      const details =
        principal.kind === "device"
          ? yield* device(principal.deviceId)
          : { deviceName: null, lastSave: null };
      const tabSync = Option.getOrNull(yield* TabSync.lastSync);
      return { _tag: "Paired", webOrigin, ...details, tabSync } satisfies View;
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed<View>(
          error._tag === "Unauthorized" || error._tag === "ConfigError"
            ? { _tag: "NotPaired", webOrigin }
            : { _tag: "Unreachable", webOrigin },
        ),
      ),
    );
  }).pipe(Effect.orElseSucceed((): View => ({ _tag: "NotPaired", webOrigin: builtInOrigin })));
