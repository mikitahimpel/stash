import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Invite from "../src/invite.ts";
import * as User from "../src/user.ts";

const account = {
  id: "user-1",
  displayName: "Synthetic member",
  role: "member",
  createdAt: "2026-01-02T03:04:05.000Z",
  dailyAiQuota: 200,
  ai: { dailyQuota: 200, usedToday: 3, waiting: 0, resetsAt: "2026-01-03T00:00:00.000Z" },
};

describe("User", () => {
  it("round-trips an account, and an owner without a quota", () => {
    const decoded = Schema.decodeUnknownSync(User.Account)(account);
    expect(Schema.encodeSync(User.Account)(decoded)).toEqual(account);
    const owner = { ...account, role: "owner", dailyAiQuota: null };
    expect(Schema.decodeUnknownSync(User.Account)(owner).dailyAiQuota).toBeNull();
  });

  it.each([
    ["an unknown role", { role: "admin" }],
    ["an empty id", { id: "" }],
    ["an empty name", { displayName: "" }],
    ["a name that is too long", { displayName: "n".repeat(101) }],
    ["a negative quota", { dailyAiQuota: -1 }],
    ["a fractional quota", { dailyAiQuota: 1.5 }],
  ])("rejects %s", (_, change) => {
    expect(() => Schema.decodeUnknownSync(User.Account)({ ...account, ...change })).toThrow();
  });

  it("gives a member 200 enrichments a day by default", () => {
    expect(User.defaultMemberDailyAiQuota).toBe(200);
  });
});

describe("Invite", () => {
  const invite = {
    id: "invite-1",
    createdAt: "2026-01-02T03:04:05.000Z",
    expiresAt: "2026-01-09T03:04:05.000Z",
    revokedAt: null,
    acceptedAt: null,
    acceptedBy: null,
  };

  it("round-trips an invite, with its token only when it was just created", () => {
    const decoded = Schema.decodeUnknownSync(Invite.Invite)(invite);
    expect(Schema.encodeSync(Invite.Invite)(decoded)).toEqual(invite);
    const created = { ...invite, token: "t".repeat(43) };
    expect(
      Schema.encodeSync(Invite.CreatedInvite)(
        Schema.decodeUnknownSync(Invite.CreatedInvite)(created),
      ),
    ).toEqual(created);
    expect("token" in Invite.Invite.fields).toBe(false);
  });

  it.each([
    "",
    "short",
    "t".repeat(31),
    "t".repeat(129),
    `${"t".repeat(40)}/..`,
    "t".repeat(40) + " ",
  ])("rejects the token %j", (token) => {
    expect(Schema.is(Invite.InviteToken)(token)).toBe(false);
  });

  it("is valid for 7 days and opens under /invite/", () => {
    expect(Invite.inviteTtlDays).toBe(7);
    expect(Invite.invitePath).toBe("/invite/");
  });
});
