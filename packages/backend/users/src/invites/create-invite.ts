import * as Invite from "@stash/contracts-domain/invite";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as RequireOwner from "../members/require-owner.ts";
import * as SecretHash from "../secret-hash.ts";
import * as InvitesRepo from "./invites-repo.ts";

/** Bytes of randomness in an invite token. */
export const tokenBytes = 32;

/**
 * The owner creates an invite: a link that signs one new person up, once, within
 * `Invite.inviteTtlDays` days. Only the hash of the token is stored; the token is in the result
 * and is never readable again.
 */
export const createInvite = Effect.gen(function* () {
  yield* RequireOwner.requireOwner;
  const repo = yield* InvitesRepo.InvitesRepo;
  const token = Invite.InviteToken.make(
    Base64Url.encode(crypto.getRandomValues(new Uint8Array(tokenBytes))),
  );
  const createdAt = yield* DateTime.now;
  const invite = yield* repo.insert({
    id: Invite.InviteId.make(crypto.randomUUID()),
    tokenHash: yield* SecretHash.hash(token),
    createdAt,
    expiresAt: DateTime.add(createdAt, { days: Invite.inviteTtlDays }),
  });
  return { ...invite, token } satisfies Invite.CreatedInvite;
}).pipe(Effect.withSpan("createInvite"));
