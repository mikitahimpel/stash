import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import type * as Security from "@stash/contracts-api/security";
import * as Device from "@stash/contracts-domain/device";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as LinksRepo from "../src/links-repo.ts";
import * as SaveRateLimiter from "../src/save/save-rate-limiter.ts";

/** A synthetic device that exists in every test database. */
export const deviceId = Device.DeviceId.make("device-zen-1");

export const device: Security.Principal = { kind: "device", deviceId };
export const user: Security.Principal = { kind: "user" };

/** A device of `Testing.member`, for tests with two users. */
export const memberDeviceId = Device.DeviceId.make("device-zen-member");

/**
 * A fresh in-memory D1 with the whole schema, the testing users, the owner's device and one
 * device of `Testing.member`.
 */
export const layerDatabase: Layer.Layer<D1Database.Database> = Layer.effectDiscard(
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
 * The repo, the limiter and in-memory platform services, with the queue's consumer side and the
 * published link events. Everything runs as the owner unless a test says otherwise
 * (`Testing.as(Testing.member)`).
 */
export const layer = (rateLimit: SaveRateLimiter.Options = SaveRateLimiter.defaultOptions) =>
  Layer.mergeAll(LinksRepo.layer, SaveRateLimiter.layer(rateLimit)).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        layerDatabase,
        Testing.layerEnrichmentQueue,
        Testing.layerKv,
        Testing.layerLinkEvents,
        Testing.layerCurrentUser(),
      ),
    ),
  );
