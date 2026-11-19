import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import type * as Security from "@stash/contracts-api/security";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as AiQuota from "../src/ai-quota.ts";
import * as InvitesRepo from "../src/invites/invites-repo.ts";
import * as UsersRepo from "../src/users-repo.ts";

/**
 * The repos and the quota on a fresh in-memory D1 with the testing users, plus in-memory
 * Vectorize, R2 and link events. Everything runs as the owner unless a test says otherwise
 * (`Testing.as(Testing.member)`).
 */
export const layer = Layer.mergeAll(UsersRepo.layer, InvitesRepo.layer, AiQuota.layer).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Testing.layerDatabase,
      Testing.layerVectors,
      Testing.layerBlobs,
      Testing.layerLinkEvents,
      Testing.layerCurrentUser(),
    ),
  ),
);

/** Inserts a synthetic link of `user`, enriched or still pending. */
export const insertLink = (
  user: Security.CurrentUser["Service"],
  id: string,
  options: { readonly enriched?: boolean; readonly tag?: string } = {},
) =>
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    const url = `https://example.com/${id}`;
    yield* db.run(
      D1Database.sql`INSERT INTO links (id, user_id, url, canonical_url, title, enriched_at)
        VALUES (${id}, ${user.id}, ${url}, ${url}, ${`Title of ${id}`},
          ${options.enriched === false ? null : "2026-01-01T00:00:00.000Z"})`,
    );
    if (options.tag !== undefined) {
      yield* db.batch([
        D1Database.sql`INSERT OR IGNORE INTO tags (name) VALUES (${options.tag})`,
        D1Database.sql`INSERT INTO link_tags (link_id, tag_id, user_id)
          SELECT ${id}, id, ${user.id} FROM tags WHERE name = ${options.tag}`,
      ]);
    }
  });

/** How many rows of `table` belong to `user`. */
export const count = (table: string, user: Security.CurrentUser["Service"]) =>
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    const rows = yield* db.all(
      D1Database.statement(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, user.id),
    );
    return Number(rows[0]?.["n"]);
  });
