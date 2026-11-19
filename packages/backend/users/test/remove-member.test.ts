import { describe, expect, it } from "@effect/vitest";
import * as Blobs from "@stash/backend-platform/blobs";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Vectors from "@stash/backend-platform/vectors";
import * as Errors from "@stash/contracts-domain/errors";
import * as User from "@stash/contracts-domain/user";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AiQuota from "../src/ai-quota.ts";
import * as RemoveMember from "../src/members/remove-member.ts";
import * as UsersRepo from "../src/users-repo.ts";
import * as UsersTestLayer from "./users-test-layer.ts";

const { owner, member, otherMember } = Testing;

/** Everything a user can hold, for `user`, with `n` links (vector and page text each). */
const fill = (user: typeof owner, prefix: string, n: number) =>
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    const vectors = yield* Vectors.Vectors;
    const blobs = yield* Blobs.Blobs;
    const device = `${prefix}-device`;
    yield* db.batch([
      D1Database.sql`INSERT INTO devices (id, user_id, name, kind)
        VALUES (${device}, ${user.id}, ${"Synthetic"}, ${"zen"})`,
      D1Database.sql`INSERT INTO api_tokens (id, user_id, device_id, hash)
        VALUES (${`${prefix}-token`}, ${user.id}, ${device}, ${`${prefix}-hash`})`,
      D1Database.sql`INSERT INTO api_tokens (id, user_id, name, hash)
        VALUES (${`${prefix}-mcp`}, ${user.id}, ${"Claude (MCP)"}, ${`${prefix}-mcp-hash`})`,
      D1Database.sql`INSERT INTO sessions (id, user_id, github_login, expires_at)
        VALUES (${`${prefix}-session`}, ${user.id}, ${prefix}, ${"2099-01-01T00:00:00.000Z"})`,
      D1Database.sql`INSERT INTO open_tabs (user_id, device_id, url, last_seen_at)
        VALUES (${user.id}, ${device}, ${"https://example.com/tab"}, ${"2026-01-01T00:00:00.000Z"})`,
      D1Database.sql`INSERT INTO commands (id, user_id, device_id, kind, payload)
        VALUES (${`${prefix}-command`}, ${user.id}, ${device}, ${"close-tab"}, ${"{}"})`,
      D1Database.sql`INSERT INTO device_pairings (code_hash, user_id, device_id, expires_at)
        VALUES (${`${prefix}-code`}, ${user.id}, ${device}, ${"2099-01-01T00:00:00.000Z"})`,
      D1Database.sql`INSERT INTO digests (user_id, period_start, period_end, content)
        VALUES (${user.id}, ${"2026-01-01"}, ${"2026-01-08"}, ${"{}"})`,
      D1Database.sql`INSERT INTO user_identities (provider, subject, user_id, label)
        VALUES (${"github"}, ${`${prefix}-subject`}, ${user.id}, ${prefix})`,
    ]);
    for (let i = 0; i < n; i++) {
      const id = `${prefix}-link-${i}`;
      yield* UsersTestLayer.insertLink(user, id, { tag: i === 0 ? `${prefix}-only` : "shared" });
      yield* vectors.upsert([{ id, values: [1, 0], metadata: { userId: user.id } }]);
      yield* blobs.put(Blobs.linkTextKey(id), `text of ${id}`);
    }
    yield* AiQuota.AiQuota.use((quota) => quota.reserve).pipe(Testing.as(user));
  });

const userTables = [
  "links",
  "link_tags",
  "devices",
  "api_tokens",
  "sessions",
  "open_tabs",
  "commands",
  "device_pairings",
  "digests",
  "user_identities",
  "ai_usage",
];

const counts = (user: typeof owner) =>
  Effect.forEach(userTables, (table) => UsersTestLayer.count(table, user)).pipe(
    Effect.map((ns) => Object.fromEntries(userTables.map((table, i) => [table, ns[i]]))),
  );

const empty = Object.fromEntries(userTables.map((table) => [table, 0]));

const matchIds = Vectors.Vectors.use((vectors) => vectors.query([1, 0], { topK: 50 })).pipe(
  Effect.map((matches) => matches.map((match) => match.id).sort()),
);

describe("removeMember", () => {
  it.effect("deletes everything the member stored, everywhere, and nothing of anyone else", () =>
    Effect.gen(function* () {
      yield* fill(owner, "owner", 2);
      yield* fill(member, "member", 3);
      yield* fill(otherMember, "other", 2);
      const ownerBefore = yield* counts(owner);
      const otherBefore = yield* counts(otherMember);

      yield* RemoveMember.removeMember(member.id);

      // D1: no row of the member in any table, and the user is gone.
      expect(yield* counts(member)).toEqual(empty);
      const users = yield* UsersRepo.UsersRepo;
      expect(yield* users.findById(member.id)).toEqual(Option.none());
      expect(yield* users.findByIdentity("github", "member-subject")).toEqual(Option.none());
      // Vectorize and R2: the member's vectors and page texts are gone.
      expect(yield* matchIds).toEqual([
        "other-link-0",
        "other-link-1",
        "owner-link-0",
        "owner-link-1",
      ]);
      const blobs = yield* Blobs.Blobs;
      for (let i = 0; i < 3; i++) {
        expect(yield* blobs.getText(Blobs.linkTextKey(`member-link-${i}`))).toEqual(Option.none());
      }
      expect(yield* blobs.getText(Blobs.linkTextKey("owner-link-0"))).toEqual(
        Option.some("text of owner-link-0"),
      );
      // Keyword search index: no row of the member left.
      const db = yield* D1Database.Database;
      const fts = yield* db.all(
        D1Database.sql`SELECT user_id FROM links_fts WHERE links_fts MATCH ${"title"}`,
      );
      expect(new Set(fts.map((row) => row["user_id"]))).toEqual(
        new Set([owner.id, otherMember.id]),
      );
      // Their streams were closed.
      expect(yield* (yield* Testing.TestLinkEvents).closed).toContain(member.id);
      // A tag only they used is gone, a shared one stays.
      const tags = yield* db.all(D1Database.sql`SELECT name FROM tags ORDER BY name`);
      expect(tags.map((row) => row["name"])).toEqual(["other-only", "owner-only", "shared"]);

      // Everyone else has exactly what they had.
      expect(yield* counts(owner)).toEqual(ownerBefore);
      expect(yield* counts(otherMember)).toEqual(otherBefore);
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("deletes more links than one round takes", () =>
    Effect.gen(function* () {
      const n = RemoveMember.chunkSize + 20;
      const db = yield* D1Database.Database;
      const rows = JSON.stringify(Array.from({ length: n }, (_, i) => `bulk-${i}`));
      yield* db.run(
        D1Database.sql`INSERT INTO links (id, user_id, url, canonical_url)
          SELECT value, ${member.id}, 'https://example.com/' || value,
            'https://example.com/' || value FROM json_each(${rows})`,
      );
      yield* Vectors.Vectors.use((vectors) =>
        vectors.upsert([
          { id: "bulk-0", values: [1, 0], metadata: { userId: member.id } },
          { id: `bulk-${n - 1}`, values: [1, 0], metadata: { userId: member.id } },
        ]),
      );
      expect(yield* UsersTestLayer.count("links", member)).toBe(n);
      yield* RemoveMember.removeMember(member.id);
      expect(yield* UsersTestLayer.count("links", member)).toBe(0);
      expect(yield* matchIds).toEqual([]);
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("only the owner removes, never the owner, and only someone who exists", () =>
    Effect.gen(function* () {
      yield* fill(member, "member", 1);
      yield* fill(otherMember, "other", 1);
      // A member removes nobody: not another member, not themselves, not the owner.
      for (const target of [otherMember.id, member.id, owner.id]) {
        expect(
          yield* RemoveMember.removeMember(target).pipe(Testing.as(member), Effect.flip),
        ).toBeInstanceOf(Errors.Forbidden);
      }
      expect(yield* RemoveMember.removeMember(owner.id).pipe(Effect.flip)).toBeInstanceOf(
        Errors.Conflict,
      );
      const missing = User.UserId.make("user-missing");
      expect(yield* RemoveMember.removeMember(missing).pipe(Effect.flip)).toEqual(
        new Errors.NotFound({ resource: "member", id: missing }),
      );
      expect(yield* UsersTestLayer.count("links", member)).toBe(1);
      expect(yield* UsersTestLayer.count("links", otherMember)).toBe(1);
      expect(Option.isSome(yield* (yield* UsersRepo.UsersRepo).findById(owner.id))).toBe(true);
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("can be run again after it failed halfway", () =>
    Effect.gen(function* () {
      yield* fill(member, "member", 2);
      // Vectorize is down: the removal fails after the member's ways in are gone.
      const failing = Vectors.Vectors.of({
        ...(yield* Vectors.Vectors),
        deleteByIds: () =>
          Effect.fail(new Vectors.VectorsError({ operation: "delete", cause: "down" })),
      });
      const error = yield* RemoveMember.removeMember(member.id).pipe(
        Effect.provideService(Vectors.Vectors, failing),
        Effect.flip,
      );
      expect(error).toBeInstanceOf(Vectors.VectorsError);
      expect(yield* UsersTestLayer.count("sessions", member)).toBe(0);
      expect(yield* UsersTestLayer.count("api_tokens", member)).toBe(0);
      expect(yield* UsersTestLayer.count("links", member)).toBe(2);

      yield* RemoveMember.removeMember(member.id);
      expect(yield* counts(member)).toEqual(empty);
      expect(yield* matchIds).toEqual([]);
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );
});
