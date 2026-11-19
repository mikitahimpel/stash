import * as Blobs from "@stash/backend-platform/blobs";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as LinkEvents from "@stash/backend-platform/link-events";
import * as Vectors from "@stash/backend-platform/vectors";
import * as Errors from "@stash/contracts-domain/errors";
import type * as User from "@stash/contracts-domain/user";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as UsersRepo from "../users-repo.ts";
import * as RequireOwner from "./require-owner.ts";

// Removing a member deletes everything they stored, in every store:
//
// 1. Their ways in go first (sessions, API tokens, sign-in accounts), and their open streams are
//    closed, so nothing of theirs is written while the rest goes.
// 2. Their links go in chunks: the vectors (Vectorize) and page texts (R2) of a chunk, then its
//    rows. D1 is last in each chunk because it is what says which vectors and texts exist.
// 3. Then the user row, which takes every remaining row along (devices, tabs, commands, digests,
//    pairings, usage: `ON DELETE CASCADE`), and the tag names nobody uses any more.
//
// It can be run again: a removal that failed halfway (Vectorize or R2 was down) leaves a user who
// cannot sign in and whose remaining data the next attempt deletes.

/** Links deleted per round. Each round is a few calls, whatever the member stored. */
export const chunkSize = 500;

const IdRow = Schema.Struct({ id: Schema.String });

const chunks = <A>(items: ReadonlyArray<A>, size: number): Array<ReadonlyArray<A>> => {
  const out: Array<ReadonlyArray<A>> = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Deletes everything stored for the user, and the user. Not for the owner. */
export const purgeUser = Effect.fn("purgeUser")(function* (id: User.UserId) {
  const db = yield* D1Database.Database;
  const vectors = yield* Vectors.Vectors;
  const blobs = yield* Blobs.Blobs;
  const events = yield* LinkEvents.LinkEvents;

  yield* db.batch([
    D1Database.sql`DELETE FROM sessions WHERE user_id = ${id}`,
    D1Database.sql`DELETE FROM api_tokens WHERE user_id = ${id}`,
    D1Database.sql`DELETE FROM user_identities WHERE user_id = ${id}`,
  ]);
  yield* events.close(id);

  while (true) {
    const rows = yield* D1Database.query(IdRow)(
      D1Database.sql`SELECT id FROM links WHERE user_id = ${id} ORDER BY seq LIMIT ${chunkSize}`,
    );
    if (rows.length === 0) break;
    const ids = rows.map((row) => row.id);
    for (const part of chunks(ids, Vectors.maxDeleteIds)) yield* vectors.deleteByIds(part);
    yield* blobs.deleteMany(ids.map(Blobs.linkTextKey));
    yield* db.run(
      D1Database.sql`DELETE FROM links WHERE user_id = ${id}
        AND id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`,
    );
  }

  yield* db.batch([
    D1Database.sql`DELETE FROM users WHERE id = ${id} AND role <> 'owner'`,
    D1Database.statement("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM link_tags)"),
  ]);
  // A stream opened between the first close and the end has nobody to carry events for.
  yield* events.close(id);
});

/**
 * The owner removes a member, with everything they stored. `NotFound` for an unknown user,
 * `Conflict` for the owner, `Forbidden` for anyone but the owner.
 */
export const removeMember = Effect.fn("removeMember")(function* (id: User.UserId) {
  yield* RequireOwner.requireOwner;
  const users = yield* UsersRepo.UsersRepo;
  const target = yield* users.findById(id);
  if (Option.isNone(target)) return yield* new Errors.NotFound({ resource: "member", id });
  if (target.value.role === "owner") {
    return yield* new Errors.Conflict({ message: "The owner cannot be removed" });
  }
  yield* purgeUser(id);
  yield* Effect.log(`members: removed ${id}`);
});
