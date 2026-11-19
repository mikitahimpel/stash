import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Errors from "@stash/contracts-domain/errors";
import * as Invite from "@stash/contracts-domain/invite";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as AcceptInvite from "../src/invites/accept-invite.ts";
import * as CreateInvite from "../src/invites/create-invite.ts";
import * as InvitesRepo from "../src/invites/invites-repo.ts";
import * as SecretHash from "../src/secret-hash.ts";
import * as UsersRepo from "../src/users-repo.ts";
import * as UsersTestLayer from "./users-test-layer.ts";

const asMember = Testing.as(Testing.member);
const account = (subject: string, label = `guest-${subject}`): UsersRepo.Identity => ({
  provider: "github",
  subject,
  label,
});
const list = InvitesRepo.InvitesRepo.use((repo) => repo.list);

describe("invites", () => {
  it.effect("the owner creates an invite: a token shown once, valid for 7 days", () =>
    Effect.gen(function* () {
      const created = yield* CreateInvite.createInvite;
      expect(Schema.is(Invite.InviteToken)(created.token)).toBe(true);
      expect(DateTime.distance(created.createdAt, created.expiresAt)).toEqual(
        DateTime.distance(created.createdAt, DateTime.add(created.createdAt, { days: 7 })),
      );
      const { token, ...listed } = created;
      expect(yield* list).toEqual([listed]);

      // Only the hash is stored.
      const rows = yield* D1Database.Database.use((db) =>
        db.all(D1Database.sql`SELECT * FROM invites`),
      );
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(rows[0]?.["token_hash"]).toBe(yield* SecretHash.hash(token));
      // Two invites never share a token.
      expect((yield* CreateInvite.createInvite).token).not.toBe(token);
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("a member cannot invite", () =>
    Effect.gen(function* () {
      const error = yield* CreateInvite.createInvite.pipe(asMember, Effect.flip);
      expect(error).toBeInstanceOf(Errors.Forbidden);
      expect(yield* list).toEqual([]);
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("accepting creates a member with the default quota and uses the invite up", () =>
    Effect.gen(function* () {
      const invite = yield* CreateInvite.createInvite;
      const member = Option.getOrThrow(
        yield* AcceptInvite.acceptInvite(invite.token, account("7001", "synthetic-guest")),
      );
      expect(member).toMatchObject({
        displayName: "synthetic-guest",
        role: "member",
        dailyAiQuota: 200,
      });
      const users = yield* UsersRepo.UsersRepo;
      expect(yield* users.findByIdentity("github", "7001")).toEqual(Option.some(member));
      const [stored] = yield* list;
      expect(stored?.acceptedBy).toBe(member.id);
      expect(stored?.acceptedAt).not.toBeNull();

      // Once: not for another account, and not for the same one again.
      expect(yield* AcceptInvite.acceptInvite(invite.token, account("7002"))).toEqual(
        Option.none(),
      );
      expect(yield* AcceptInvite.acceptInvite(invite.token, account("7001"))).toEqual(
        Option.none(),
      );
      expect(yield* users.findByIdentity("github", "7002")).toEqual(Option.none());
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("an account that already has a user does not spend a second invite", () =>
    Effect.gen(function* () {
      const first = yield* CreateInvite.createInvite;
      const second = yield* CreateInvite.createInvite;
      yield* AcceptInvite.acceptInvite(first.token, account("7001"));
      expect(yield* AcceptInvite.acceptInvite(second.token, account("7001"))).toEqual(
        Option.none(),
      );
      const stored = (yield* list).find((invite) => invite.id === second.id);
      expect(stored?.acceptedAt).toBeNull();
      expect((yield* (yield* UsersRepo.UsersRepo).list).map((user) => user.role)).toEqual([
        "owner",
        "member",
        "member",
        "member",
      ]);
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("an expired, a revoked or an unknown invite is not open", () =>
    Effect.gen(function* () {
      const repo = yield* InvitesRepo.InvitesRepo;
      const revoked = yield* CreateInvite.createInvite;
      expect(yield* repo.revoke(revoked.id, yield* DateTime.now)).toBe("revoked");
      expect(yield* AcceptInvite.findOpenInvite(revoked.token)).toEqual(Option.none());
      expect(yield* AcceptInvite.acceptInvite(revoked.token, account("7001"))).toEqual(
        Option.none(),
      );

      const expiring = yield* CreateInvite.createInvite;
      yield* TestClock.adjust("167 hours");
      expect(Option.isSome(yield* AcceptInvite.findOpenInvite(expiring.token))).toBe(true);
      yield* TestClock.adjust("1 hour");
      expect(yield* AcceptInvite.findOpenInvite(expiring.token)).toEqual(Option.none());
      expect(yield* AcceptInvite.acceptInvite(expiring.token, account("7002"))).toEqual(
        Option.none(),
      );

      const unknown = Invite.InviteToken.make("u".repeat(43));
      expect(yield* AcceptInvite.findOpenInvite(unknown)).toEqual(Option.none());
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );

  it.effect("revoking keeps the first time, and refuses an accepted or unknown invite", () =>
    Effect.gen(function* () {
      const repo = yield* InvitesRepo.InvitesRepo;
      const invite = yield* CreateInvite.createInvite;
      const first = yield* DateTime.now;
      expect(yield* repo.revoke(invite.id, first)).toBe("revoked");
      yield* TestClock.adjust("1 hour");
      expect(yield* repo.revoke(invite.id, yield* DateTime.now)).toBe("revoked");
      expect((yield* list)[0]?.revokedAt).toEqual(first);

      const accepted = yield* CreateInvite.createInvite;
      yield* AcceptInvite.acceptInvite(accepted.token, account("7001"));
      expect(yield* repo.revoke(accepted.id, yield* DateTime.now)).toBe("accepted");
      expect(yield* repo.revoke(Invite.InviteId.make("missing"), yield* DateTime.now)).toBe(
        "missing",
      );
    }).pipe(Effect.provide(UsersTestLayer.layer)),
  );
});
