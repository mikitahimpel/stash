import * as AuthGuard from "@stash/web-auth/auth-guard";
import * as Auth from "@stash/web-auth/routes";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createRouter, type Router, type RouterHistory, type RouteRecordRaw } from "vue-router";
import * as Placeholder from "./placeholder-routes.ts";

/** The routes of every feature package, mounted at the top level. */
export const featureRoutes: ReadonlyArray<RouteRecordRaw> = [
  ...Placeholder.links,
  ...Placeholder.search,
  ...Placeholder.openTabs,
  ...Placeholder.settings,
];

export const routes: ReadonlyArray<RouteRecordRaw> = [
  { path: "/", redirect: { name: "links" } },
  ...Auth.routes,
  ...featureRoutes,
  { path: "/:pathMatch(.*)*", redirect: "/links" },
];

/**
 * The app router, with the auth guard installed: every route but the login page needs a session,
 * checked against the api of `registry`. `main.ts` passes the browser history (`createWebHistory`),
 * and tests pass `createMemoryHistory`.
 */
export const make = (history: RouterHistory, registry: AtomRegistry.AtomRegistry): Router => {
  const router = createRouter({ history, routes: [...routes] });
  AuthGuard.install(router, registry);
  return router;
};
