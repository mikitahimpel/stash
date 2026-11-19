import * as Security from "@stash/contracts-api/security";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * The services a layer captures when it is built, to provide to effects it runs later (a handler,
 * a queue message, a cron job): `Effect.context`, without the user.
 *
 * Who the user is belongs to each call, never to the layer: a request's user comes from
 * `Authorization`, a queue message's from its link, a cron job's from the loop over users. A
 * captured context that carried a user would override the caller's when it is provided, and
 * every call would run as whoever was current when the layer was built. So the user (and the
 * principal) are dropped here, whatever the build context held.
 */
export const capture = <R>(): Effect.Effect<
  Context.Context<Exclude<R, Security.CurrentUser | Security.CurrentPrincipal>>,
  never,
  R
> => Effect.map(Effect.context<R>(), Context.omit(Security.CurrentUser, Security.CurrentPrincipal));
