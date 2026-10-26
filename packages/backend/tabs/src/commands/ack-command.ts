import type * as Security from "@stash/contracts-api/security";
import type * as Command from "@stash/contracts-domain/command";
import * as Errors from "@stash/contracts-domain/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as DeviceAccess from "../device-access.ts";
import * as CommandsRepo from "./commands-repo.ts";

const notFound = (id: Command.CommandId) => new Errors.NotFound({ resource: "command", id });

const notPending = () => new Errors.Conflict({ message: "The command is no longer pending" });

/** Records a command's outcome: `pending` becomes `done` or `failed`, once. */
export const ackCommand = Effect.fn("ackCommand")(function* (
  principal: Security.Principal,
  id: Command.CommandId,
  status: CommandsRepo.Outcome,
) {
  const repo = yield* CommandsRepo.CommandsRepo;
  const command = yield* Effect.fromOption(yield* repo.findById(id)).pipe(
    Effect.mapError(() => notFound(id)),
  );
  yield* DeviceAccess.authorizeCommandsAccess(principal, command.deviceId);
  if (command.status !== "pending") return yield* notPending();
  // A concurrent ack may have won since the read.
  if (!(yield* repo.complete(id, status, yield* DateTime.now))) return yield* notPending();
  return yield* Effect.fromOption(yield* repo.findById(id)).pipe(
    Effect.mapError(() => notFound(id)),
  );
});
