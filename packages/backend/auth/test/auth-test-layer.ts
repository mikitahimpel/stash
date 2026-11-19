import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as InvitesRepo from "@stash/backend-users/invites-repo";
import * as UsersRepo from "@stash/backend-users/users-repo";
import type * as Security from "@stash/contracts-api/security";
import * as Device from "@stash/contracts-domain/device";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** A synthetic device that exists in every test database. */
export const deviceId = Device.DeviceId.make("device-zen-1");

/** A device of `Testing.member`, for tests with two users. */
export const memberDeviceId = Device.DeviceId.make("device-zen-member");

/** A fresh in-memory D1 with the whole schema, the testing users and one device for two of them. */
export const layerD1: Layer.Layer<D1Database.Database> = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    yield* db.batch([
      D1Database.sql`INSERT INTO devices (id, user_id, name, kind)
        VALUES (${deviceId}, ${Testing.owner.id}, ${"Synthetic Zen"}, ${"zen"})`,
      D1Database.sql`INSERT INTO devices (id, user_id, name, kind)
        VALUES (${memberDeviceId}, ${Testing.member.id}, ${"Member Zen"}, ${"zen"})`,
    ]);
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerDatabase));

/**
 * `layerD1` with the users and invites repos, running as the owner unless a test says otherwise
 * (`Testing.as(Testing.member)`).
 */
export const layerDatabase: Layer.Layer<
  D1Database.Database | UsersRepo.UsersRepo | InvitesRepo.InvitesRepo | Security.CurrentUser
> = Layer.mergeAll(UsersRepo.layer, InvitesRepo.layer, Testing.layerCurrentUser()).pipe(
  Layer.provideMerge(layerD1),
);
