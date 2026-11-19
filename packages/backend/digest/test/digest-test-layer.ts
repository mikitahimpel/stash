import * as LinksRepo from "@stash/backend-links/links-repo";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as CommandsRepo from "@stash/backend-tabs/commands-repo";
import * as DevicesRepo from "@stash/backend-tabs/devices-repo";
import * as OpenTabsRepo from "@stash/backend-tabs/open-tabs-repo";
import type * as StashConfig from "@stash/backend-platform/stash-config";
import * as Device from "@stash/contracts-domain/device";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DigestsRepo from "../src/digests-repo.ts";

/** Synthetic devices that exist in every test database. */
export const zen = Device.DeviceId.make("device-zen");
export const iphone = Device.DeviceId.make("device-iphone");
/** A Zen of the second user (`Testing.member`). */
export const memberZen = Device.DeviceId.make("device-member-zen");

/** A fresh in-memory D1 with the schema, the testing users and the synthetic devices. */
export const layerDatabase: Layer.Layer<D1Database.Database> = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    yield* db.batch([
      D1Database.sql`INSERT INTO devices (user_id, id, name, kind)
        VALUES ('owner', ${zen}, 'Synthetic Zen', 'zen')`,
      D1Database.sql`INSERT INTO devices (user_id, id, name, kind)
        VALUES ('owner', ${iphone}, 'Synthetic iPhone', 'ios')`,
      D1Database.sql`INSERT INTO devices (user_id, id, name, kind)
        VALUES (${Testing.member.id}, ${memberZen}, 'Synthetic member Zen', 'zen')`,
    ]);
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerDatabase));

/**
 * The repos this package uses, over in-memory platform services. Everything runs as the owner
 * unless a test says otherwise (`Testing.as(Testing.member)`).
 */
export const layer = (config: Partial<StashConfig.StashConfig["Service"]> = {}) =>
  Layer.mergeAll(
    DigestsRepo.layer,
    LinksRepo.layer,
    DevicesRepo.layer,
    OpenTabsRepo.layer,
    CommandsRepo.layer,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        layerDatabase,
        Testing.layerEnrichmentQueue,
        Testing.layerKv,
        Testing.layerLinkEvents,
        Testing.layerCurrentUser(),
        Testing.layerStashConfig(config),
      ),
    ),
  );
