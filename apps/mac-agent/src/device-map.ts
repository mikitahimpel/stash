/**
 * Which Stash device each iCloud device was registered as, persisted in a local JSON state file so
 * a restart doesn't register the same iPhone again.
 *
 * The file holds `{ "devices": { "<iCloud device_uuid>": "<Stash DeviceId>" } }`. It is written to
 * a temporary file first and then renamed over the old one, so a crash never leaves it half written.
 */
import * as Device from "@stash/contracts-domain/device";
import { Config, Context, Effect, FileSystem, Layer, Option, Ref, Schema } from "effect";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where the state file lives unless {@link pathEnvVar} says otherwise. */
export const defaultPath = (home: string): string =>
  join(home, "Library/Application Support/stash-mac-agent/state.json");

/** Env var that overrides {@link defaultPath}. */
export const pathEnvVar = "STASH_STATE_FILE";

export class DeviceMapError extends Schema.TaggedError<DeviceMapError>()("DeviceMapError", {
  path: Schema.String,
  message: Schema.String,
}) {}

export class DeviceMap extends Context.Service<
  DeviceMap,
  {
    /** The Stash device registered for an iCloud device, if any. */
    readonly get: (cloudDeviceId: string) => Effect.Effect<Option.Option<Device.DeviceId>>;
    readonly set: (
      cloudDeviceId: string,
      deviceId: Device.DeviceId,
    ) => Effect.Effect<void, DeviceMapError>;
    /** Forgets a mapping, for example after the Stash device was deleted. */
    readonly remove: (cloudDeviceId: string) => Effect.Effect<void, DeviceMapError>;
  }
>()("@stash/mac-agent/DeviceMap") {}

const State = Schema.Struct({
  devices: Schema.Record(Schema.String, Device.DeviceId),
});
type State = typeof State.Type;

const StateJson = Schema.fromJsonString(State);
const decodeState = Schema.decodeUnknownEffect(StateJson);
const encodeState = Schema.encodeEffect(StateJson);

const empty: State = { devices: {} };

const without = (devices: State["devices"], id: string): State["devices"] =>
  Object.fromEntries(Object.entries(devices).filter(([key]) => key !== id));

/** A map that lives only in memory, for tests. */
export const layerMemory = (initial: State["devices"] = {}): Layer.Layer<DeviceMap> =>
  Layer.effect(
    DeviceMap,
    Effect.gen(function* () {
      const ref = yield* Ref.make<State["devices"]>(initial);
      return {
        get: (id) => Effect.map(Ref.get(ref), (devices) => Option.fromNullishOr(devices[id])),
        set: (id, deviceId) => Ref.update(ref, (devices) => ({ ...devices, [id]: deviceId })),
        remove: (id) => Ref.update(ref, (devices) => without(devices, id)),
      };
    }),
  );

/** A map backed by the JSON file at `path`. A missing file is an empty map. */
export const layer = (
  path: string,
): Layer.Layer<DeviceMap, DeviceMapError, FileSystem.FileSystem> =>
  Layer.effect(
    DeviceMap,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const fail = (error: unknown) => new DeviceMapError({ path, message: String(error) });

      const initial = yield* fs.exists(path).pipe(
        Effect.flatMap((exists) =>
          exists ? Effect.flatMap(fs.readFileString(path), decodeState) : Effect.succeed(empty),
        ),
        Effect.mapError(fail),
      );
      const ref = yield* Ref.make(initial.devices);

      const save = (devices: State["devices"]) =>
        Effect.gen(function* () {
          const json = yield* encodeState({ devices });
          const tmp = `${path}.tmp`;
          yield* fs.makeDirectory(dirname(path), { recursive: true });
          yield* fs.writeFileString(tmp, `${json}\n`);
          yield* fs.rename(tmp, path);
          yield* Ref.set(ref, devices);
        }).pipe(Effect.mapError(fail));

      return {
        get: (id) => Effect.map(Ref.get(ref), (devices) => Option.fromNullishOr(devices[id])),
        set: (id, deviceId) =>
          Effect.flatMap(Ref.get(ref), (devices) => save({ ...devices, [id]: deviceId })),
        remove: (id) => Effect.flatMap(Ref.get(ref), (devices) => save(without(devices, id))),
      };
    }),
  );

/** Reads the path from {@link pathEnvVar}, falling back to {@link defaultPath}. */
export const layerConfig: Layer.Layer<
  DeviceMap,
  DeviceMapError | Config.ConfigError,
  FileSystem.FileSystem
> = Layer.unwrap(
  Effect.map(Config.String(pathEnvVar).pipe(Config.withDefault(defaultPath(homedir()))), layer),
);
