import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as AckCommand from "./commands/ack-command.ts";
import type * as CommandsRepo from "./commands/commands-repo.ts";
import * as EnqueueCommand from "./commands/enqueue-command.ts";
import * as ListPendingCommands from "./commands/list-pending-commands.ts";
import type * as DevicesRepo from "./devices/devices-repo.ts";
import * as ListDevices from "./devices/list-devices.ts";
import * as RegisterDevice from "./devices/register-device.ts";

// Database failures are defects here: the endpoints declare no error for them, so they answer 500.

/** The `devices` group of the `StashApi`. Needs `DevicesRepo`, `CommandsRepo` and `Authorization`. */
export const layer = HttpApiBuilder.group(Api.StashApi, "devices", (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<DevicesRepo.DevicesRepo | CommandsRepo.CommandsRepo>();
    const withServices = Effect.provideContext(context);
    return handlers
      .handle("list", () =>
        ListDevices.listDevices.pipe(withServices, Effect.catchTag("DatabaseError", Effect.die)),
      )
      .handle("register", ({ payload }) =>
        RegisterDevice.registerDevice(payload).pipe(
          withServices,
          Effect.catchTag("DatabaseError", Effect.die),
        ),
      )
      .handle("sendCommand", ({ params, payload }) =>
        EnqueueCommand.enqueueCommand(params.id, payload).pipe(
          withServices,
          Effect.catchTag("DatabaseError", Effect.die),
        ),
      )
      .handle("listCommands", ({ params, query }) =>
        Effect.gen(function* () {
          const principal = yield* Security.CurrentPrincipal;
          return yield* ListPendingCommands.listCommands(principal, params.id, query.status);
        }).pipe(withServices, Effect.catchTag("DatabaseError", Effect.die)),
      )
      .handle("ackCommand", ({ params, payload }) =>
        Effect.gen(function* () {
          const principal = yield* Security.CurrentPrincipal;
          return yield* AckCommand.ackCommand(principal, params.id, payload.status);
        }).pipe(withServices, Effect.catchTag("DatabaseError", Effect.die)),
      );
  }),
);
