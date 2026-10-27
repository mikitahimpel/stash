import type { RouteRecordRaw } from "vue-router";

/** The "Open now" page. `apps/web` mounts these; the layout nav links to the `open-tabs` name. */
export const routes: ReadonlyArray<RouteRecordRaw> = [
  { path: "/open-now", name: "open-tabs", component: () => import("./open-tabs-page.vue") },
];
