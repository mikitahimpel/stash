import * as LinksRepo from "@stash/backend-links/links-repo";
import * as SaveRateLimiter from "@stash/backend-links/save-rate-limiter";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import type * as Security from "@stash/contracts-api/security";
import * as Device from "@stash/contracts-domain/device";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as CommandsRepo from "../src/commands/commands-repo.ts";
import * as DevicesRepo from "../src/devices/devices-repo.ts";
import * as OpenTabsRepo from "../src/snapshots/open-tabs-repo.ts";

/** Synthetic devices that exist in every test database, oldest first. */
export const zenA = Device.DeviceId.make("device-zen-a");
export const zenB = Device.DeviceId.make("device-zen-b");
export const macAgent = Device.DeviceId.make("device-mac-agent");
export const iphone = Device.DeviceId.make("device-iphone");
/** A Zen of the second user (`Testing.member`): no owner's request may see or change it. */
export const memberZen = Device.DeviceId.make("device-member-zen");

export const asDevice = (deviceId: Device.DeviceId): Security.Principal => ({
  kind: "device",
  deviceId,
});
export const user: Security.Principal = { kind: "user" };

/**
 * A fresh in-memory D1 with the schema, the testing users, the owner's synthetic devices and one
 * device of the member.
 */
export const layerDatabase: Layer.Layer<D1Database.Database> = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    yield* db.batch([
      D1Database.sql`INSERT INTO devices (user_id, id, name, kind, created_at)
        VALUES ('owner', ${zenA}, 'Synthetic Zen A', 'zen', '2026-01-01T00:00:00.000Z')`,
      D1Database.sql`INSERT INTO devices (user_id, id, name, kind, created_at)
        VALUES ('owner', ${zenB}, 'Synthetic Zen B', 'zen', '2026-01-01T00:00:01.000Z')`,
      D1Database.sql`INSERT INTO devices (user_id, id, name, kind, created_at)
        VALUES ('owner', ${macAgent}, 'Synthetic Mac', 'mac-agent', '2026-01-01T00:00:02.000Z')`,
      D1Database.sql`INSERT INTO devices (user_id, id, name, kind, created_at)
        VALUES ('owner', ${iphone}, 'Synthetic iPhone', 'ios', '2026-01-01T00:00:03.000Z')`,
      D1Database.sql`INSERT INTO devices (user_id, id, name, kind, created_at)
        VALUES (${Testing.member.id}, ${memberZen}, 'Synthetic member Zen', 'zen',
          '2026-01-01T00:00:04.000Z')`,
    ]);
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerDatabase));

/**
 * The repos of this package and of links, over in-memory platform services. Everything runs as the
 * owner unless a test says otherwise (`Testing.as(Testing.member)`).
 */
export const layer = Layer.mergeAll(
  DevicesRepo.layer,
  OpenTabsRepo.layer,
  CommandsRepo.layer,
  LinksRepo.layer,
  SaveRateLimiter.layer(),
).pipe(
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
