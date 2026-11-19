import * as Invite from "@stash/contracts-domain/invite";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

export const CheckInvite = Schema.Struct({
  token: Invite.InviteToken,
});
export type CheckInvite = typeof CheckInvite.Type;

/**
 * Invites: how a new person gets in. Only the owner creates, lists and revokes them (`Forbidden`
 * for a member). An invite works once and for `inviteTtlDays` days. The owner sends the link
 * `<web origin>/invite/<token>`; the page there asks `check` (open: the token is the credential,
 * `NotFound` for one that is unknown, used, revoked or expired, without saying which) and then
 * signs the person in, passing the token to `auth.devicePoll`, which creates their account.
 */
export class InvitesGroup extends HttpApiGroup.make("invites")
  .add(
    HttpApiEndpoint.get("list", "/invites", {
      success: Schema.Array(Invite.Invite),
      error: ErrorStatuses.Forbidden,
    }).middleware(Security.Authorization),
    // The only response that carries the token.
    HttpApiEndpoint.post("create", "/invites", {
      success: Invite.CreatedInvite.pipe(HttpApiSchema.status(201)),
      error: ErrorStatuses.Forbidden,
    }).middleware(Security.Authorization),
    // Revokes an invite nobody accepted. It stays listed with `revokedAt` set. `Conflict` once it
    // was accepted: remove the member instead.
    HttpApiEndpoint.delete("revoke", "/invites/:id", {
      params: { id: Invite.InviteId },
      success: HttpApiSchema.NoContent,
      error: [ErrorStatuses.Forbidden, ErrorStatuses.NotFound, ErrorStatuses.Conflict],
    }).middleware(Security.Authorization),
  )
  .add(
    HttpApiEndpoint.post("check", "/invites/check", {
      payload: CheckInvite,
      success: Invite.OpenInvite,
      error: ErrorStatuses.NotFound,
    }),
  ) {}
