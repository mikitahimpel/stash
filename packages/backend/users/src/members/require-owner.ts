import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import * as Effect from "effect/Effect";

/** Succeeds for the owner. A member gets `Forbidden`: they manage nobody and invite nobody. */
export const requireOwner: Effect.Effect<void, Errors.Forbidden, Security.CurrentUser> =
  Effect.flatMap(Effect.service(Security.CurrentUser), (user) =>
    user.role === "owner"
      ? Effect.void
      : Effect.fail(new Errors.Forbidden({ message: "Only the owner may do this" })),
  );
