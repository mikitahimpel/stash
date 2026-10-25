import * as ApiAtoms from "@stash/web-api-client/api-atoms";

/**
 * Who is signed in. Fails with `Unauthorized` when there is no session. The auth guard refreshes it
 * before every navigation.
 */
export const me = ApiAtoms.query(["auth"], (client) => client.auth.me());

/** Ends the session. The api clears the session cookie. */
export const logout = ApiAtoms.mutation(["auth"], (client) => client.auth.logout());
