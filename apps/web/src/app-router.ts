import { routes as settings } from "@stash/web-settings/routes";
import { createRouter, type Router, type RouterHistory, type RouteRecordRaw } from "vue-router";
import * as Placeholder from "./placeholder-routes.ts";

/** The routes of every feature package, mounted at the top level. */
export const featureRoutes: ReadonlyArray<RouteRecordRaw> = [
  ...Placeholder.links,
  ...Placeholder.search,
  ...Placeholder.openTabs,
  ...settings,
];

export const routes: ReadonlyArray<RouteRecordRaw> = [
  { path: "/", redirect: { name: "links" } },
  ...featureRoutes,
  { path: "/:pathMatch(.*)*", redirect: "/links" },
];

/**
 * The app router. `main.ts` passes the browser history (`createWebHistory`), and tests pass
 * `createMemoryHistory`.
 */
export const make = (history: RouterHistory): Router =>
  createRouter({ history, routes: [...routes] });
