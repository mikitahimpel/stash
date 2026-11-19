import * as D1Database from "@stash/backend-platform/d1-database";
import * as Security from "@stash/contracts-api/security";
import * as Digest from "@stash/contracts-domain/digest";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The `digests` table. `content` holds the JSON of the whole contracts `Digest`; the period and
// `generated_at` columns repeat its fields so digests can be found and ordered in SQL.

/** The `digests` table: the current user's digests (`CurrentUser`). Each user has their own. */
export class DigestsRepo extends Context.Service<
  DigestsRepo,
  {
    /** Stores the digest. A digest of the same period is replaced. */
    readonly save: (
      digest: Digest.Digest,
    ) => Effect.Effect<void, D1Database.DatabaseError, Security.CurrentUser>;
    /** The digest with the latest period end, if any was built. */
    readonly latest: Effect.Effect<
      Option.Option<Digest.Digest>,
      D1Database.DatabaseError,
      Security.CurrentUser
    >;
  }
>()("@stash/backend-digest/DigestsRepo") {}

const Content = Schema.fromJsonString(Digest.Digest);
const DigestRow = Schema.Struct({ content: Content });
const encodeContent = Schema.encodeSync(Content);

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  return DigestsRepo.of({
    save: (digest) =>
      Effect.flatMap(Effect.service(Security.CurrentUser), (user) =>
        db.run(
          D1Database.sql`INSERT INTO digests
              (user_id, period_start, period_end, generated_at, content)
            VALUES (${user.id}, ${DateTime.formatIso(digest.periodStart)},
              ${DateTime.formatIso(digest.periodEnd)}, ${DateTime.formatIso(digest.generatedAt)},
              ${encodeContent(digest)})
            ON CONFLICT (user_id, period_start, period_end) DO UPDATE SET
              generated_at = excluded.generated_at, content = excluded.content`,
        ),
      ).pipe(Effect.asVoid),
    latest: Effect.flatMap(Effect.service(Security.CurrentUser), (user) =>
      D1Database.queryFirst(DigestRow)(
        D1Database.statement(
          `SELECT content FROM digests WHERE user_id = ?
            ORDER BY period_end DESC, generated_at DESC, id DESC LIMIT 1`,
          user.id,
        ),
      ).pipe(Effect.map(Option.map((row) => row.content)), provide),
    ),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<DigestsRepo, never, D1Database.Database> =
  Layer.effect(DigestsRepo)(make);
