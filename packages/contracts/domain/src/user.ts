import { Schema } from "effect";

export const UserId = Schema.String.pipe(Schema.check(Schema.isNonEmpty()), Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

/** The owner runs the deploy and invites people. Everyone they invite is a member. */
export const UserRole = Schema.Literals(["owner", "member"]);
export type UserRole = typeof UserRole.Type;

export const DisplayName = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(100)),
);

const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

/**
 * How many links a day (UTC) the user may have enriched by AI (summary, tags, embedding), or
 * `null` for no cap. Links saved past the cap are stored at once and enriched on a later day.
 */
export const DailyAiQuota = Schema.NullOr(Count);
export type DailyAiQuota = typeof DailyAiQuota.Type;

/** The quota a new member starts with. The owner has none. */
export const defaultMemberDailyAiQuota = 200;

/** A person with their own stash. Every link, device, token and tab belongs to exactly one. */
export const User = Schema.Struct({
  id: UserId,
  displayName: DisplayName,
  role: UserRole,
  createdAt: Schema.DateTimeUtcFromString,
  dailyAiQuota: DailyAiQuota,
});
export type User = typeof User.Type;

/** A user's AI enrichment today (UTC): the cap and how much of it is used. */
export const AiUsage = Schema.Struct({
  dailyQuota: DailyAiQuota,
  usedToday: Count,
  /** Links saved and still waiting, because today's cap is used up. They are enriched later. */
  waiting: Count,
  /** The start of the next UTC day, when the count starts again. */
  resetsAt: Schema.DateTimeUtcFromString,
});
export type AiUsage = typeof AiUsage.Type;

/** The signed-in user as they see themselves. */
export const Account = Schema.Struct({
  ...User.fields,
  ai: AiUsage,
});
export type Account = typeof Account.Type;
