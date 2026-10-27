import * as AuthGuard from "@stash/web-auth/auth-guard";
import * as Auth from "@stash/web-auth/routes";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Links from "@stash/web-links/routes";
import * as OpenTabs from "@stash/web-open-tabs/routes";
import { createRouter, type Router, type RouterHistory, type RouteRecordRaw } from "vue-router";
import * as Search from "@stash/web-search/routes";
import * as Settings from "@stash/web-settings/routes";

/** The routes of every feature package, mounted at the top level. */
export const featureRoutes: ReadonlyArray<RouteRecordRaw> = [
  ...Links.routes,
  ...Search.routes,
  ...OpenTabs.routes,
  ...Settings.routes,
];

/**
 * Dev-only pages. `import.meta.env.DEV` is `false` in the production build, which drops them and
 * their chunks; there `/_ui` falls through to the catch-all redirect.
 */
export const devRoutes: ReadonlyArray<RouteRecordRaw> = import.meta.env.DEV
  ? [
      {
        path: "/_ui",
        name: "ui-gallery",
        component: () => import("./ui-gallery-page.vue"),
        // Opens without a session, outside the app layout.
        meta: { public: true },
      },
    ]
  : [];

export const routes: ReadonlyArray<RouteRecordRaw> = [
  { path: "/", redirect: { name: "links" } },
  ...Auth.routes,
  ...featureRoutes,
  ...devRoutes,
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
