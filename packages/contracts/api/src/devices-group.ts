import * as Command from "@stash/contracts-domain/command";
import * as Device from "@stash/contracts-domain/device";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

export const RegisterDevice = Schema.Struct({
  name: Device.DeviceName,
  kind: Device.DeviceKind,
});
export type RegisterDevice = typeof RegisterDevice.Type;

export const ListCommandsQuery = Schema.Struct({
  status: Schema.optionalKey(Command.CommandStatus),
});
export type ListCommandsQuery = typeof ListCommandsQuery.Type;

/** How a device reports a command's outcome. */
export const AckCommand = Schema.Struct({
  status: Schema.Literals(["done", "failed"]),
});
export type AckCommand = typeof AckCommand.Type;

const DeviceIdParams = { id: Device.DeviceId };

export class DevicesGroup extends HttpApiGroup.make("devices")
  .add(
    HttpApiEndpoint.get("list", "/devices", {
      success: Schema.Array(Device.Device),
    }),
    HttpApiEndpoint.post("register", "/devices", {
      payload: RegisterDevice,
      success: Device.Device.pipe(HttpApiSchema.status(201)),
    }),
    HttpApiEndpoint.post("sendCommand", "/devices/:id/commands", {
      params: DeviceIdParams,
      payload: Command.CommandPayload,
      success: Command.Command.pipe(HttpApiSchema.status(201)),
      error: ErrorStatuses.NotFound,
    }),
    // Devices poll this with `?status=pending`.
    HttpApiEndpoint.get("listCommands", "/devices/:id/commands", {
      params: DeviceIdParams,
      query: ListCommandsQuery,
      success: Schema.Array(Command.Command),
      error: ErrorStatuses.NotFound,
    }),
    // `Conflict` when the command is no longer pending.
    HttpApiEndpoint.post("ackCommand", "/commands/:id/ack", {
      params: { id: Command.CommandId },
      payload: AckCommand,
      success: Command.Command,
      error: [ErrorStatuses.NotFound, ErrorStatuses.Conflict],
    }),
  )
  .middleware(Security.Authorization) {}
