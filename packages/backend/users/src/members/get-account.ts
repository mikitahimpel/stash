import * as D1Database from "@stash/backend-platform/d1-database";
import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import type * as User from "@stash/contracts-domain/user";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as AiQuota from "../ai-quota.ts";
import * as UsersRepo from "../users-repo.ts";

const WaitingRow = Schema.Struct({ waiting: Schema.Int });

/**
 * The current user's own account with today's AI usage. `waiting` counts their links that are
 * saved and not enriched yet: with the cap used up, those wait for a later day.
 */
export const getAccount = Effect.gen(function* () {
  const current = yield* Security.CurrentUser;
  const users = yield* UsersRepo.UsersRepo;
  const quota = yield* AiQuota.AiQuota;
  const user = yield* Effect.fromOption(yield* users.findById(current.id)).pipe(
    Effect.mapError(() => new Errors.Unauthorized({ message: "The account no longer exists" })),
    Effect.orDie,
  );
  const usage = yield* quota.usage;
  const waiting = yield* D1Database.queryFirst(WaitingRow)(
    D1Database.sql`SELECT COUNT(*) AS waiting FROM links
      WHERE user_id = ${current.id} AND enriched_at IS NULL AND enrichment_error IS NULL`,
  );
  const now = yield* DateTime.now;
  return {
    ...user,
    ai: {
      dailyQuota: usage.dailyQuota,
      usedToday: usage.usedToday,
      waiting: Option.match(waiting, { onNone: () => 0, onSome: (row) => row.waiting }),
      resetsAt: AiQuota.nextDay(now),
    },
  } satisfies User.Account;
}).pipe(Effect.withSpan("getAccount"));
