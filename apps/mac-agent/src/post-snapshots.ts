/**
 * Sends iCloud tab snapshots to the Stash API.
 *
 * Every iCloud device (each iPhone or iPad signed in to the same Apple account) becomes a Stash
 * device of its own. The first time a device shows up it is registered with `POST /devices`, and
 * the returned id is kept in the {@link DeviceMap.DeviceMap} so later runs report to the same device.
 * Snapshots go to `PUT /devices/:id/tabs`.
 *
 * A snapshot whose tabs (URLs and titles) equal the last one posted for that device is skipped, so
 * an idle iPhone costs no writes. That memory lives in the poster, so the first run after a restart
 * posts every device once.
 */
import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Device from "@stash/contracts-domain/device";
import * as Tab from "@stash/contracts-domain/tab";
import { Context, Effect, Layer, Option, Redacted, Ref } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api";
import * as CloudTabsReader from "./cloud-tabs-reader.ts";
import * as DeviceMap from "./device-map.ts";

export interface ApiConfig {
  readonly baseUrl: string;
  readonly deviceToken: Redacted.Redacted<string>;
}

const makeClient = (config: ApiConfig) =>
  Effect.gen(function* () {
    const httpClient = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl(config.baseUrl)),
    );
    return yield* HttpApiClient.makeWith(Api.StashApi, { httpClient }).pipe(
      Effect.provide(
        HttpApiMiddleware.layerClient(Security.Authorization, ({ next, request }) =>
          next(HttpClientRequest.bearerToken(request, Redacted.value(config.deviceToken))),
        ),
      ),
    );
  });

/** The typed Stash API client, authenticated with the device token. */
export class StashClient extends Context.Service<
  StashClient,
  Effect.Success<ReturnType<typeof makeClient>>
>()("@stash/mac-agent/StashClient") {}

/** Needs an `HttpClient`: Node's in `main.ts`, a stub server in tests. */
export const clientLayer = (
  config: ApiConfig,
): Layer.Layer<StashClient, never, HttpClient.HttpClient> =>
  Layer.effect(StashClient, makeClient(config));

/** What one {@link SnapshotPoster} run did, by iCloud device id. */
export interface PostResult {
  readonly registered: ReadonlyArray<string>;
  readonly posted: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
}

const fallbackName = (cloudDeviceId: string) => `iCloud device ${cloudDeviceId.slice(0, 8)}`;

/** A valid `DeviceName`: trimmed, non-empty, at most 100 characters. */
export const deviceName = (device: CloudTabsReader.CloudDevice): string => {
  const name = (device.name ?? "").trim().slice(0, 100).trim();
  return name === "" ? fallbackName(device.snapshot.deviceId) : name;
};

/** The part of a snapshot that counts as a change: URLs and titles, in order. */
export const fingerprint = (snapshot: Tab.TabsSnapshot): string =>
  JSON.stringify(snapshot.tabs.map((tab) => [tab.url, tab.title]));

const make = Effect.gen(function* () {
  const client = yield* StashClient;
  const devices = yield* DeviceMap.DeviceMap;
  const lastPosted = yield* Ref.make(new Map<string, string>());

  const resolve = (device: CloudTabsReader.CloudDevice) => {
    const cloudId = device.snapshot.deviceId;
    return Effect.flatMap(
      devices.get(cloudId),
      Option.match({
        onSome: (id) => Effect.succeed({ id, registered: false }),
        onNone: () =>
          client.devices.register({ payload: { name: deviceName(device), kind: "ios" } }).pipe(
            Effect.tap((registered) => devices.set(cloudId, registered.id)),
            Effect.tap((registered) =>
              Effect.logInfo("Registered iCloud device").pipe(
                Effect.annotateLogs({ cloudDeviceId: cloudId, deviceId: registered.id }),
              ),
            ),
            Effect.map((registered) => ({ id: registered.id, registered: true })),
          ),
      }),
    );
  };

  const report = (id: Device.DeviceId, snapshot: Tab.TabsSnapshot) =>
    client.tabs.report({
      params: { id },
      payload: { takenAt: snapshot.takenAt, tabs: snapshot.tabs },
    });

  const postOne = (device: CloudTabsReader.CloudDevice) =>
    Effect.gen(function* () {
      const cloudId = device.snapshot.deviceId;
      const print = fingerprint(device.snapshot);
      const { id, registered } = yield* resolve(device);
      if (!registered && (yield* Ref.get(lastPosted)).get(cloudId) === print) {
        return { cloudId, registered, outcome: "skipped" as const };
      }
      yield* report(id, device.snapshot).pipe(
        // The Stash device was deleted: forget it so the next run registers a new one.
        Effect.tapError((error) =>
          error._tag === "NotFound" ? devices.remove(cloudId) : Effect.void,
        ),
      );
      yield* Ref.update(lastPosted, (map) => new Map(map).set(cloudId, print));
      return { cloudId, registered, outcome: "posted" as const };
    });

  return {
    post: (cloudDevices: ReadonlyArray<CloudTabsReader.CloudDevice>) =>
      Effect.map(Effect.forEach(cloudDevices, postOne), (results): PostResult => ({
        registered: results.filter((r) => r.registered).map((r) => r.cloudId),
        posted: results.filter((r) => r.outcome === "posted").map((r) => r.cloudId),
        skipped: results.filter((r) => r.outcome === "skipped").map((r) => r.cloudId),
      })),
  };
});

export class SnapshotPoster extends Context.Service<SnapshotPoster, Effect.Success<typeof make>>()(
  "@stash/mac-agent/SnapshotPoster",
) {}

export const layer: Layer.Layer<SnapshotPoster, never, StashClient | DeviceMap.DeviceMap> =
  Layer.effect(SnapshotPoster, make);
