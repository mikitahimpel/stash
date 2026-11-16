import type { RouteRecordRaw } from "vue-router";
import * as ConnectStatus from "./connect-status.ts";

const isSource = (value: unknown): value is ConnectStatus.Source =>
  typeof value === "string" && (ConnectStatus.sources as ReadonlyArray<string>).includes(value);

/**
 * The Connect page (`/connect`, `?guide=iphone|extension|mac|claude` opens that guide in place),
 * and `/connect/extension?code=…`, which the extension opens to be approved.
 */
export const routes: ReadonlyArray<RouteRecordRaw> = [
  {
    path: "/connect",
    name: "connect",
    component: () => import("./connect-page.vue"),
    props: (route) => (isSource(route.query.guide) ? { guide: route.query.guide } : {}),
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
