import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as AiQuota from "../src/ai-quota.ts";
import * as UsersTestLayer from "./users-test-layer.ts";

const quota = AiQuota.AiQuota;
const asMember = Testing.as(Testing.member);

const setQuota = (userId: string, value: number | null) =>
  D1Database.Database.use((db) =>
    db.run(D1Database.sql`UPDATE users SET daily_ai_quota = ${value} WHERE id = ${userId}`),
  );

describe("AiQuota", () => {
  it.effect("lets a member enrich up to the cap a day, and not one link more", () =>
    Effect.gen(function* () {
      yield* setQuota(Testing.member.id, 3);
      const service = yield* quota;
      for (let i = 0; i < 3; i++) expect(yield* service.reserve.pipe(asMember)).toBe(true);
      expect(yield* service.reserve.pipe(asMember)).toBe(false);
      expect(yield* service.reserve.pipe(asMember)).toBe(false);
      expect(yield* service.usage.pipe(asMember)).toEqual({ dailyQuota: 3, usedToday: 3 });
      expect(AiQuota.remaining(yield* service.usage.pipe(asMember))).toBe(0);
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("starts again on the next UTC day", () =>
    Effect.gen(function* () {
      yield* setQuota(Testing.member.id, 1);
      const service = yield* quota;
      // 23:59 UTC of the test clock's first day.
      yield* TestClock.adjust("1439 minutes");
      expect(yield* service.reserve.pipe(asMember)).toBe(true);
      expect(yield* service.reserve.pipe(asMember)).toBe(false);
      yield* TestClock.adjust("1 minute");
      expect(yield* service.usage.pipe(asMember)).toEqual({ dailyQuota: 1, usedToday: 0 });
      expect(yield* service.reserve.pipe(asMember)).toBe(true);
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("has no cap for the owner, and still counts", () =>
    Effect.gen(function* () {
      const service = yield* quota;
      for (let i = 0; i < 250; i++) expect(yield* service.reserve).toBe(true);
      const usage = yield* service.usage;
      expect(usage).toEqual({ dailyQuota: null, usedToday: 250 });
      expect(AiQuota.remaining(usage)).toBe(Infinity);
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("counts each user separately", () =>
    Effect.gen(function* () {
      yield* setQuota(Testing.member.id, 1);
      yield* setQuota(Testing.otherMember.id, 1);
      const service = yield* quota;
      expect(yield* service.reserve.pipe(asMember)).toBe(true);
      expect(yield* service.reserve.pipe(asMember)).toBe(false);
      // The other member's day is untouched by the first one's.
      expect(yield* service.reserve.pipe(Testing.as(Testing.otherMember))).toBe(true);
      expect(yield* service.usage).toEqual({ dailyQuota: null, usedToday: 0 });
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("gives a released enrichment back, never below zero", () =>
    Effect.gen(function* () {
      yield* setQuota(Testing.member.id, 1);
      const service = yield* quota;
      yield* service.release.pipe(asMember);
      expect(yield* service.reserve.pipe(asMember)).toBe(true);
      expect(yield* service.reserve.pipe(asMember)).toBe(false);
      yield* service.release.pipe(asMember);
      yield* service.release.pipe(asMember);
      expect(yield* service.usage.pipe(asMember)).toEqual({ dailyQuota: 1, usedToday: 0 });
      expect(yield* service.reserve.pipe(asMember)).toBe(true);
      expect(yield* service.reserve.pipe(asMember)).toBe(false);
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("a cap of zero, or a user who is gone, enriches nothing", () =>
    Effect.gen(function* () {
      yield* setQuota(Testing.member.id, 0);
      const service = yield* quota;
      expect(yield* service.reserve.pipe(asMember)).toBe(false);
      const gone = { id: "user-gone" as typeof Testing.member.id, role: "member" as const };
      expect(yield* service.reserve.pipe(Testing.as(gone))).toBe(false);
      expect(AiQuota.remaining(yield* service.usage.pipe(Testing.as(gone)))).toBe(0);
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it("names the UTC day and the start of the next one", () => {
    const at = DateTime.makeUnsafe("2026-03-04T23:59:59.999Z");
    expect(AiQuota.dayOf(at)).toBe("2026-03-04");
    expect(DateTime.formatIso(AiQuota.nextDay(at))).toBe("2026-03-05T00:00:00.000Z");
  });
});
