import * as Connect from "@stash/web-connect/routes";
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
  ...Connect.routes,
  ...Settings.routes,
];

/**
 * Dev-only pages. `import.meta.env.DEV` is `false` in the production build, which drops them and
 * its chunk; there `/_ui` falls through to the catch-all redirect.
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

/** The sticky header's height on a phone (two lines), plus some air: px above an anchor. */
const headerClearance = 120;

/**
 * The app router, with the auth guard installed: every route but the login page needs a session,
 * checked against the api of `registry`. `main.ts` passes the browser history (`createWebHistory`),
 * and tests pass `createMemoryHistory`.
 */
export const make = (history: RouterHistory, registry: AtomRegistry.AtomRegistry): Router => {
  const router = createRouter({
    history,
    routes: [...routes],
    // An anchor (`/settings#connections`, where `/connect` leads) scrolls to its section, clear
    // of the sticky header; back and forward return to where the page was.
    scrollBehavior: (to, _from, saved) =>
      saved ?? (to.hash === "" ? undefined : { el: to.hash, top: headerClearance }),
  });
  AuthGuard.install(router, registry);
  return router;
};
