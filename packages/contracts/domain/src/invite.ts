import { Schema } from "effect";
import * as User from "./user.ts";

export const InviteId = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand("InviteId"),
);
export type InviteId = typeof InviteId.Type;

/**
 * The secret in an invite link (`<web origin>/invite/<token>`): 32 random bytes as base64url. The
 * api stores only its hash, so the link is shown once, when the invite is created.
 */
export const InviteToken = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^[A-Za-z0-9_-]{32,128}$/, {
      message: "Expected a base64url invite token of 32 to 128 characters",
    }),
  ),
  Schema.brand("InviteToken"),
);
export type InviteToken = typeof InviteToken.Type;

/** How long an invite can be accepted. */
export const inviteTtlDays = 7;

/** The path of the web app's invite page, before the token. */
export const invitePath = "/invite/";

/**
 * An invite as the owner lists it. It works once: `acceptedAt` and `acceptedBy` are set when
 * someone signs up with it. A revoked or expired invite signs nobody up.
 */
export const Invite = Schema.Struct({
  id: InviteId,
  createdAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  revokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  acceptedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  /** The member who signed up with it, while they exist. */
  acceptedBy: Schema.NullOr(User.UserId),
});
export type Invite = typeof Invite.Type;

/** A freshly created invite. The token is returned exactly once. */
export const CreatedInvite = Schema.Struct({
  ...Invite.fields,
  token: InviteToken,
});
export type CreatedInvite = typeof CreatedInvite.Type;

/** What anyone holding an invite link may know about it: that it can still be accepted. */
export const OpenInvite = Schema.Struct({
  expiresAt: Schema.DateTimeUtcFromString,
});
export type OpenInvite = typeof OpenInvite.Type;
