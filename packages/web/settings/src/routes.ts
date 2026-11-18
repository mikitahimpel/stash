import * as ConnectStatus from "@stash/web-connect/connect-status";
import type { RouteRecordRaw } from "vue-router";

const isSource = (value: unknown): value is ConnectStatus.Source =>
  typeof value === "string" && (ConnectStatus.sources as ReadonlyArray<string>).includes(value);

/**
 * The Settings page. `?guide=iphone|extension|mac|claude` opens that guide in place in its
 * "Devices & connections" section (`/connect?guide=…` redirects here).
 */
export const routes: ReadonlyArray<RouteRecordRaw> = [
  {
    path: "/settings",
    name: "settings",
    component: () => import("./settings-page.vue"),
    props: (route) => (isSource(route.query.guide) ? { guide: route.query.guide } : {}),
  },
];
