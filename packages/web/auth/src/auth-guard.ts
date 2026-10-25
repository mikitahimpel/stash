import * as Unauthenticated from "@stash/web-api-client/unauthenticated";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { Router } from "vue-router";
import * as AuthAtoms from "./auth-atoms.ts";
import * as Routes from "./routes.ts";

// Asks the api who is signed in: `true` when `me` succeeds, `false` when it answers `Unauthorized`,
// and `undefined` when it can't tell (the api is down or answers garbage). Then navigation goes on
// and the page shows the error, rather than sending the user to a login that would not help. The
// registry may still hold an earlier answer, so `me` is refreshed and the read waits for the new one.
const signedIn = (registry: AtomRegistry.AtomRegistry): Promise<boolean | undefined> => {
  registry.refresh(AuthAtoms.me);
  return Effect.runPromise(
    Effect.exit(AtomRegistry.getResult(registry, AuthAtoms.me, { suspendOnWaiting: true })).pipe(
      Effect.map((exit) => (Exit.isSuccess(exit) ? true : Exit.hasDies(exit) ? undefined : false)),
    ),
  );
};

/**
 * Protects every route but the login page:
 *
 * - before each navigation it asks the api who is signed in (`me`) and redirects to the login page
 *   when nobody is, or away from it when somebody is;
 * - on every `unauthenticated` event (a 401 from any api call, for example once the session
 *   expired) it sends the user to the login page.
 *
 * Returns the function that removes the guard.
 */
export const install = (router: Router, registry: AtomRegistry.AtomRegistry): (() => void) => {
  // The guard's own `me` request answers 401 when nobody is signed in. The guard redirects then,
  // so the `unauthenticated` listener ignores events while a check runs.
  let checks = 0;

  const removeGuard = router.beforeEach(async (to) => {
    checks++;
    const status = await signedIn(registry).finally(() => checks--);
    if (Routes.isPublic(to)) return status === true ? "/" : true;
    return status === false ? { name: Routes.login } : true;
  });

  const stopListening = Unauthenticated.onUnauthenticated(registry, () => {
    if (checks === 0 && !Routes.isPublic(router.currentRoute.value)) {
      void router.push({ name: Routes.login });
    }
  });

  return () => {
    removeGuard();
    stopListening();
  };
};
