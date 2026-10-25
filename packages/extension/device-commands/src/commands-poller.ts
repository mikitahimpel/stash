import * as Command from "@stash/contracts-domain/command";
import type * as Device from "@stash/contracts-domain/device";
import * as Alarms from "@stash/ext-platform/browser-alarms";
import type * as Tabs from "@stash/ext-platform/browser-tabs";
import * as StashApiClient from "@stash/ext-platform/stash-api-client";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ExecuteCommand from "./execute-command.ts";

/** The alarm that drives polling. */
export const alarmName = "stash/device-commands";

/** How often the extension asks for pending commands. Firefox allows no less than ~30 seconds. */
export const periodInMinutes = 1;

/** The device token belongs to the web session, not to a device, so there is nothing to poll. */
export class NotADeviceError extends Data.TaggedError("NotADeviceError")<{}> {}

/** One command the device acked, and how. */
export interface Executed {
  readonly id: Command.CommandId;
  readonly status: ExecuteCommand.Outcome;
}

// The list is decoded one command at a time, so a command of a kind this build doesn't know yet
// (added on the server later) is acked `failed` instead of breaking the whole poll.
const decodeCommand = Schema.decodeUnknownOption(Command.Command);
const decodeId = Schema.decodeUnknownOption(Schema.Struct({ id: Command.CommandId }));

/** The device id of the saved token, from `GET /auth/me`. */
const currentDevice = Effect.gen(function* () {
  const client = yield* StashApiClient.StashApiClient;
  const principal = yield* client.auth.me();
  if (principal.kind !== "device") return yield* new NotADeviceError();
  return principal.deviceId;
});

const pendingCommands = Effect.fnUntraced(function* (deviceId: Device.DeviceId) {
  const client = yield* StashApiClient.StashApiClient;
  const response = yield* client.devices.listCommands({
    params: { id: deviceId },
    query: { status: "pending" },
    responseMode: "response-only",
  });
  const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
    Effect.flatMap((ok) => ok.json),
  );
  return Array.isArray(body) ? body : [];
});

const ack = (id: Command.CommandId, status: ExecuteCommand.Outcome) =>
  Effect.flatMap(StashApiClient.StashApiClient, (client) =>
    client.devices.ackCommand({ params: { id }, payload: { status } }),
  ).pipe(
    Effect.as(Option.some<Executed>({ id, status })),
    // `Conflict`: someone else acked it first. Every other failure leaves it pending for the
    // next poll.
    Effect.catch((error) =>
      Effect.as(Effect.logWarning("ack failed", id, error), Option.none<Executed>()),
    ),
  );

const run = (raw: unknown) =>
  Option.match(decodeCommand(raw), {
    onSome: (command) =>
      Effect.flatMap(ExecuteCommand.execute(command.payload), (status) => ack(command.id, status)),
    onNone: () =>
      Option.match(decodeId(raw), {
        onSome: ({ id }) => ack(id, "failed"),
        onNone: () => Effect.succeedNone,
      }),
  });

/**
 * Fetches this device's pending commands, runs each one in order and acks it `done` or `failed`.
 * Returns the commands it acked. Does nothing until a config is saved on the options page.
 */
export const pollOnce: Effect.Effect<
  ReadonlyArray<Executed>,
  Effect.Error<typeof currentDevice> | Effect.Error<ReturnType<typeof pendingCommands>>,
  StashApiClient.StashApiClient | Tabs.Tabs
> = Effect.gen(function* () {
  const deviceId = yield* currentDevice;
  const commands = yield* pendingCommands(deviceId);
  const acked = yield* Effect.forEach(commands, run);
  return acked.flatMap(Option.toArray);
}).pipe(
  Effect.catchIf(
    (error) => error._tag === "ConfigError" && error.reason === "Missing",
    () => Effect.succeed([]),
  ),
);

/**
 * Polls on start and on every `alarmName` alarm until the layer is released. The alarm is created
 * only when missing, so waking the background page doesn't push the next poll back.
 */
export const layer: Layer.Layer<
  never,
  never,
  Alarms.Alarms | StashApiClient.StashApiClient | Tabs.Tabs
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const alarms = yield* Alarms.Alarms;
    // One poll at a time, so an alarm during the start-up poll can't run a command twice.
    const lock = yield* Semaphore.make(1);
    const poll = pollOnce.pipe(
      Effect.ignore({ log: "Warn", message: "polling commands failed" }),
      Semaphore.withPermit(lock),
    );
    yield* alarms.fired.pipe(
      Stream.filter((alarm) => alarm.name === alarmName),
      Stream.runForEach(() => poll),
      Effect.forkScoped,
    );
    const existing = yield* alarms.list.pipe(Effect.orElseSucceed(() => []));
    if (!existing.some((alarm) => alarm.name === alarmName)) {
      yield* alarms
        .create(alarmName, { periodInMinutes })
        .pipe(Effect.ignore({ log: "Warn", message: "creating the commands alarm failed" }));
    }
    yield* Effect.forkScoped(poll);
  }),
);
