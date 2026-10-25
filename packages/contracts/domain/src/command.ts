import { Schema } from "effect";
import * as Device from "./device.ts";
import * as Link from "./link.ts";

export const CommandId = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand("CommandId"),
);
export type CommandId = typeof CommandId.Type;

export const CommandStatus = Schema.Literals(["pending", "done", "failed"]);
export type CommandStatus = typeof CommandStatus.Type;

/** Close every tab with this URL on the target device. */
export const CloseTabPayload = Schema.Struct({
  kind: Schema.Literal("close-tab"),
  url: Link.Url,
});
export type CloseTabPayload = typeof CloseTabPayload.Type;

/** The payload union, discriminated by `kind`. Add a member here for each new command. */
export const CommandPayload = Schema.Union([CloseTabPayload]);
export type CommandPayload = typeof CommandPayload.Type;

export const CommandKind = Schema.Literals(["close-tab"]);
export type CommandKind = typeof CommandKind.Type;

/** A command queued for a device. The device picks it up and reports the outcome. */
export const Command = Schema.Struct({
  id: CommandId,
  deviceId: Device.DeviceId,
  payload: CommandPayload,
  status: CommandStatus,
  createdAt: Schema.DateTimeUtcFromString,
  completedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type Command = typeof Command.Type;
