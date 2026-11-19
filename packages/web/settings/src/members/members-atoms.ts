import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as Invite from "@stash/contracts-domain/invite";
import type * as User from "@stash/contracts-domain/user";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as SettingsAtoms from "../settings-atoms.ts";

/** The signed-in user's account: their role, and their AI use today. */
export const account = ApiAtoms.query(["account", "links"], (client) => client.members.me());

/** Everyone in this stash. Only the owner may ask. */
export const members = ApiAtoms.query(["members"], (client) => client.members.list());

/** Every invite the owner made. Only the owner may ask. */
export const invites = ApiAtoms.query(["invites"], (client) => client.invites.list());

/**
 * Makes an invite. The result holds the only copy of its token the client ever sees. Write
 * `Atom.Reset` once the link has been shown to drop it.
 */
export const createInvite = ApiAtoms.mutation(["invites"], (client) => client.invites.create());

/** Revokes an invite that nobody has used. */
export const revokeInvite = ApiAtoms.mutation(["invites"], (client, id: Invite.InviteId) =>
  client.invites.revoke({ params: { id } }),
);

/** Removes a member and deletes everything they stored. */
export const removeMember = ApiAtoms.mutation(["members", "invites"], (client, id: User.UserId) =>
  client.members.remove({ params: { id } }),
);

/** The link to send: the web app's address and the invite's token. */
export const inviteLink = (origin: string, token: Invite.InviteToken): string =>
  `${origin}${Invite.invitePath}${token}`;

/** The invites someone can still use at `now`, soonest to expire first. */
export const openInvites = (
  all: ReadonlyArray<Invite.Invite>,
  now: DateTime.Utc,
): ReadonlyArray<Invite.Invite> =>
  all
    .filter(
      (invite) =>
        invite.acceptedAt === null &&
        invite.revokedAt === null &&
        DateTime.isGreaterThan(invite.expiresAt, now),
    )
    .sort((a, b) => DateTime.toEpochMillis(a.expiresAt) - DateTime.toEpochMillis(b.expiresAt));

/** `expires in 3 days`, `expires in 5 hours`, `expires in under an hour`. */
export const formatExpiry = (expiresAt: DateTime.Utc, now: DateTime.Utc): string => {
  const hours = (DateTime.toEpochMillis(expiresAt) - DateTime.toEpochMillis(now)) / 3_600_000;
  if (hours < 1) return "expires in under an hour";
  if (hours < 24) {
    const whole = Math.floor(hours);
    return `expires in ${whole} ${whole === 1 ? "hour" : "hours"}`;
  }
  const days = Math.floor(hours / 24);
  return `expires in ${days} ${days === 1 ? "day" : "days"}`;
};

/**
 * What to say about today's AI use, or `undefined` when there is nothing to say: no daily cap
 * (the owner), or a cap that is far from used and nothing waiting.
 *
 * Links over the cap are saved as always; only their summary and tags wait for the next day. So
 * this is a quiet line, never an error.
 */
export const quotaNotice = (ai: User.AiUsage): string | undefined => {
  if (ai.dailyQuota === null) return undefined;
  const used = `${Math.min(ai.usedToday, ai.dailyQuota)} of ${ai.dailyQuota} links summarized today`;
  if (ai.usedToday < ai.dailyQuota) return used;
  return ai.waiting > 0
    ? `${used} · ${ai.waiting} more ${ai.waiting === 1 ? "is" : "are"} saved and will be summarized tomorrow`
    : `${used} · links saved now are summarized tomorrow`;
};

const clipboardRuntime = Atom.runtime((get) => get(SettingsAtoms.clipboard));

/** Copies an invite link. */
export const copyLink = clipboardRuntime.fn((link: string) =>
  Effect.gen(function* () {
    const clipboard = yield* Clipboard.Clipboard;
    yield* clipboard.writeString(link);
  }),
);
