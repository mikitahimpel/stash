import * as Unauthenticated from "@stash/web-api-client/unauthenticated";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { Router } from "vue-router";
import * as AuthAtoms from "./auth-atoms.ts";
import * as Routes from "./routes.ts";

// Asks the api who is signed in and waits for the answer: `true` when `me` succeeds, `false` when
// it answers `Unauthorized`, and `undefined` when it can't tell (the api is down or answers
// garbage). Then navigation goes on and the page shows the error, rather than sending the user to
// a login that would not help. The registry may still hold an earlier answer, so `me` is refreshed
// (unless a request is already running) and the read waits for the new one.
const askApi = (registry: AtomRegistry.AtomRegistry): Promise<boolean | undefined> => {
  if (!registry.get(AuthAtoms.me).waiting) registry.refresh(AuthAtoms.me);
  return Effect.runPromise(
    Effect.exit(AtomRegistry.getResult(registry, AuthAtoms.me, { suspendOnWaiting: true })).pipe(
      Effect.map((exit) => (Exit.isSuccess(exit) ? true : Exit.hasDies(exit) ? undefined : false)),
    ),
  );
};

// Whether `me` holds a success from an earlier check.
const cachedSignedIn = (registry: AtomRegistry.AtomRegistry): boolean =>
  AsyncResult.isSuccess(registry.get(AuthAtoms.me));

/**
 * Protects every route but the public ones (`Routes.isPublic`):
 *
 * - before each navigation it checks who is signed in. A cached `me` success lets the navigation
 *   through at once and refreshes `me` in the background; without one it waits for the api. When
 *   nobody is signed in it redirects to the login page, which keeps the page the user wanted
 *   (`Routes.loginFor`); a signed-in user is sent away from the login page to that page;
 * - on every `unauthenticated` event (a 401 from any api call, for example once the session
 *   expired) it marks the session signed out (`AuthAtoms.signedOut`) and sends the user to the
 *   login page, to come back to the current page.
 *
 * Returns the function that removes the guard.
 */
export const install = (router: Router, registry: AtomRegistry.AtomRegistry): (() => void) => {
  // Keeps `me` cached from the first check for as long as the guard is installed.
  let unmountMe: (() => void) | undefined;

  // The guard's own `me` request answers 401 when nobody is signed in. The guard redirects then,
  // so the listener doesn't navigate while a check runs.
  let checks = 0;
  const check = () => {
    unmountMe ??= registry.mount(AuthAtoms.me);
    checks++;
    return askApi(registry).finally(() => checks--);
  };
  const signedOut = () => registry.get(AuthAtoms.signedOut);

  const removeGuard = router.beforeEach(async (to) => {
    if (Routes.isPublic(to)) {
      // Public pages other than the login page open either way, without asking the api.
      if (to.name !== Routes.login || signedOut()) return true;
      const status = await check();
      return status === true && !signedOut() ? Routes.returnTo(to.query) : true;
    }
    if (signedOut()) return Routes.loginFor(to.fullPath);
    if (cachedSignedIn(registry)) {
      // Stale-while-revalidate: a 401 from this refresh sends the user to the login page.
      registry.refresh(AuthAtoms.me);
      return true;
    }
    const status = await check();
    return status === false || signedOut() ? Routes.loginFor(to.fullPath) : true;
  });

  const stopListening = Unauthenticated.onUnauthenticated(registry, () => {
    registry.set(AuthAtoms.signedOut, true);
    const current = router.currentRoute.value;
    if (checks === 0 && !Routes.isPublic(current)) {
      void router.push(Routes.loginFor(current.fullPath));
    }
  });

  return () => {
    removeGuard();
    stopListening();
    unmountMe?.();
  };
};
