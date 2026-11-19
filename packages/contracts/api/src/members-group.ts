import * as User from "@stash/contracts-domain/user";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

/** A member as the owner lists them, with what they hold. */
export const Member = Schema.Struct({
  ...User.User.fields,
  links: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type Member = typeof Member.Type;

/**
 * The people of this Stash. `me` is the caller's own account (with today's AI usage), for anyone
 * signed in. The rest is the owner's: `list` answers every user, the owner first, and `remove`
 * deletes a member with everything they stored (links, tags, devices, tokens, tabs, digests,
 * sessions, vectors, page texts, open streams). Anyone else gets `Forbidden`. The owner cannot be
 * removed (`Conflict`).
 */
export class MembersGroup extends HttpApiGroup.make("members")
  .add(
    HttpApiEndpoint.get("me", "/members/me", {
      success: User.Account,
    }),
    HttpApiEndpoint.get("list", "/members", {
      success: Schema.Array(Member),
      error: ErrorStatuses.Forbidden,
    }),
    HttpApiEndpoint.delete("remove", "/members/:id", {
      params: { id: User.UserId },
      success: HttpApiSchema.NoContent,
      error: [ErrorStatuses.Forbidden, ErrorStatuses.NotFound, ErrorStatuses.Conflict],
    }),
  )
  .middleware(Security.Authorization) {}
