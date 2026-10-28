import * as Kv from "@stash/backend-platform/kv";
import * as AuthGroup from "@stash/contracts-api/auth";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// Started device flows in KV, one key per `flowId`, expiring with the flow. Only GitHub's
// `device_code` and the polling schedule are stored: never an access token, which is used once to
// read the login and then dropped.

/** A started flow. `deviceCode` never leaves the server. */
export const StoredDeviceFlow = Schema.Struct({
  deviceCode: Schema.String,
  /** Minimum seconds between two polls of GitHub. */
  interval: Schema.Int,
  expiresAt: Schema.DateTimeUtcFromString,
  /** The earliest time the next poll may reach GitHub. */
  nextPollAt: Schema.DateTimeUtcFromString,
});
export type StoredDeviceFlow = typeof StoredDeviceFlow.Type;

const Json = Schema.fromJsonString(StoredDeviceFlow);
const encode = Schema.encodeEffect(Json);
const decode = Schema.decodeEffect(Json);

/** KV rejects an `expirationTtl` below 60 seconds. */
const minimumTtlSeconds = 60;

/** The KV key of a flow. */
export const key = (flowId: AuthGroup.DeviceFlowId): string => `device-flow:${flowId}`;

/** The started device flows. KV failures are defects. */
export class DeviceFlowsStore extends Context.Service<
  DeviceFlowsStore,
  {
    /** Stores or replaces a flow until its `expiresAt`. */
    readonly put: (flowId: AuthGroup.DeviceFlowId, flow: StoredDeviceFlow) => Effect.Effect<void>;
    /** The flow, if it exists and has not expired. */
    readonly find: (
      flowId: AuthGroup.DeviceFlowId,
    ) => Effect.Effect<Option.Option<StoredDeviceFlow>>;
    readonly remove: (flowId: AuthGroup.DeviceFlowId) => Effect.Effect<void>;
  }
>()("@stash/backend-auth/DeviceFlowsStore") {}

export const make = Effect.gen(function* () {
  const kv = yield* Kv.Kv;
  return DeviceFlowsStore.of({
    put: (flowId, flow) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const seconds = Math.ceil(Duration.toMillis(DateTime.distance(now, flow.expiresAt)) / 1000);
        yield* kv.put(key(flowId), yield* encode(flow), {
          expirationTtl: Math.max(seconds, minimumTtlSeconds),
        });
      }).pipe(Effect.orDie),
    find: (flowId) =>
      Effect.gen(function* () {
        const stored = yield* kv.get(key(flowId));
        if (Option.isNone(stored)) return Option.none();
        const flow = yield* decode(stored.value);
        // KV may keep a key up to the 60 second minimum TTL past the flow's own expiry.
        return DateTime.isLessThanOrEqualTo(flow.expiresAt, yield* DateTime.now)
          ? Option.none()
          : Option.some(flow);
      }).pipe(Effect.orDie),
    remove: (flowId) => kv.delete(key(flowId)).pipe(Effect.orDie),
  });
});

/** The store over the KV namespace. */
export const layer: Layer.Layer<DeviceFlowsStore, never, Kv.Kv> =
  Layer.effect(DeviceFlowsStore)(make);
