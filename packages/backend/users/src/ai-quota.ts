import * as D1Database from "@stash/backend-platform/d1-database";
import * as Security from "@stash/contracts-api/security";
import type * as User from "@stash/contracts-domain/user";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The daily cap on AI enrichment (#177): how many of a user's links a UTC day may be summarized,
// tagged and embedded (`users.daily_ai_quota`, NULL for no cap; `ai_usage` counts). A link past
// the cap is still saved. It stays pending, and the hourly requeue sends it again once the user
// has room, which is the next day at the latest.
//
// What the count leaves out, on purpose: a run that ends `Failed` releases its reservation, even
// though the model may already have been called, so a user whose links keep failing can use more
// AI than the cap. Query embeddings for semantic search are not counted at all. Both are cheap
// next to an enrichment, and counting them would make a failure or a search cost a user a link.
//
// Everything here is about the current user (`CurrentUser`).

/** The UTC day of a moment, as `ai_usage.day` holds it. */
export const dayOf = (at: DateTime.Utc): string => DateTime.formatIso(at).slice(0, 10);

/** The start of the UTC day after `at`: when the count starts again. */
export const nextDay = (at: DateTime.Utc): DateTime.Utc =>
  DateTime.add(DateTime.startOf(at, "day"), { days: 1 });

export interface Usage {
  readonly dailyQuota: User.DailyAiQuota;
  readonly usedToday: number;
}

/** How many more links may be enriched today. `Infinity` without a cap. */
export const remaining = (usage: Usage): number =>
  usage.dailyQuota === null ? Infinity : Math.max(usage.dailyQuota - usage.usedToday, 0);

export class AiQuota extends Context.Service<
  AiQuota,
  {
    /**
     * Counts one enrichment for the current user today, if their cap leaves room. `false`, with
     * nothing counted, when it does not. One statement, so concurrent enrichments never pass the
     * cap together.
     */
    readonly reserve: Effect.Effect<boolean, D1Database.DatabaseError, Security.CurrentUser>;
    /** Gives one reserved enrichment back: it did not run, or failed and will run again. */
    readonly release: Effect.Effect<void, D1Database.DatabaseError, Security.CurrentUser>;
    /** The current user's cap and today's count. */
    readonly usage: Effect.Effect<Usage, D1Database.DatabaseError, Security.CurrentUser>;
  }
>()("@stash/backend-users/AiQuota") {}

const UsageRow = Schema.Struct({
  dailyQuota: Schema.NullOr(Schema.Int),
  usedToday: Schema.Int,
});

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  const today = Effect.map(DateTime.now, dayOf);
  return AiQuota.of({
    reserve: Effect.gen(function* () {
      const user = yield* Security.CurrentUser;
      const day = yield* today;
      const counted = yield* db.first(
        D1Database.sql`INSERT INTO ai_usage (user_id, day, links)
          SELECT u.id, ${day}, 1 FROM users u
          WHERE u.id = ${user.id} AND (u.daily_ai_quota IS NULL OR u.daily_ai_quota > 0)
          ON CONFLICT (user_id, day) DO UPDATE SET links = links + 1
          WHERE links < COALESCE(
            (SELECT daily_ai_quota FROM users WHERE id = excluded.user_id), links + 1)
          RETURNING links`,
      );
      return Option.isSome(counted);
    }),
    release: Effect.gen(function* () {
      const user = yield* Security.CurrentUser;
      const day = yield* today;
      yield* db.run(
        D1Database.sql`UPDATE ai_usage SET links = MAX(links - 1, 0)
          WHERE user_id = ${user.id} AND day = ${day}`,
      );
    }),
    usage: Effect.gen(function* () {
      const user = yield* Security.CurrentUser;
      const day = yield* today;
      const row = yield* D1Database.queryFirst(UsageRow)(
        D1Database.sql`SELECT u.daily_ai_quota AS dailyQuota,
            COALESCE((SELECT links FROM ai_usage a WHERE a.user_id = u.id AND a.day = ${day}), 0)
              AS usedToday
          FROM users u WHERE u.id = ${user.id}`,
      ).pipe(provide);
      // A user removed a moment ago has no room.
      return Option.getOrElse(row, (): Usage => ({ dailyQuota: 0, usedToday: 0 }));
    }),
  });
});

/** The quota over the D1 `Database`. */
export const layer: Layer.Layer<AiQuota, never, D1Database.Database> = Layer.effect(AiQuota)(make);

/** No cap and no counting: for code that runs the pipeline outside the api (scripts, tests). */
export const layerUnlimited: Layer.Layer<AiQuota> = Layer.succeed(AiQuota)({
  reserve: Effect.succeed(true),
  release: Effect.void,
  usage: Effect.succeed({ dailyQuota: null, usedToday: 0 }),
});
