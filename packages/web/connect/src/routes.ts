import type { RouteRecordRaw } from "vue-router";

/** The anchor of the "Devices & connections" section on the Settings page. */
export const connectionsHash = "#connections";

/**
 * Connect is the first section of Settings (`connect-section.vue`, mounted by
 * `@stash/web-settings`). `/connect` and `/connect?guide=iphone|extension|mac|claude`, which the
 * guides, the docs and the extension link to, go to that section with the same guide open.
 * `/connect/extension?code=…` is the page the extension opens to be approved.
 */
export const routes: ReadonlyArray<RouteRecordRaw> = [
  {
    path: "/connect",
    name: "connect",
    redirect: (to) => ({ name: "settings", query: to.query, hash: connectionsHash }),
  },
  {
    path: "/connect/extension",
    name: "connect-extension",
    component: () => import("./pair/connect-extension-page.vue"),
    props: (route) => ({
      code: typeof route.query.code === "string" ? route.query.code : undefined,
    }),
  },
];
