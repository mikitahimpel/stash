import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as Atom from "effect/reactivity/Atom";

/**
 * Who is signed in. Fails with `Unauthorized` when there is no session. Like every api query it is
 * cached and revalidated: the auth guard trusts a cached success and refreshes it in the
 * background, and asks the api (and waits) only when nothing is cached.
 */
export const me = ApiAtoms.query(["auth"], (client) => client.auth.me());

/**
 * `true` once any api call answered 401 (the session is missing or expired), until a sign-in
 * completes. While it is set the guard sends every guarded page to the login page and keeps the
 * login page open, even if a cached `me` still says otherwise.
 */
export const signedOut: Atom.Writable<boolean> = Atom.make(false).pipe(Atom.keepAlive);

/** Ends the session. The api clears the session cookie. */
export const logout = ApiAtoms.mutation(["auth"], (client) => client.auth.logout());
