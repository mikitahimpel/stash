import type { RouteRecordRaw } from "vue-router";

/** The links feature: the feeds at `/links` and one link at `/links/:id`. */
export const routes: ReadonlyArray<RouteRecordRaw> = [
  { path: "/links", name: "links", component: () => import("./list/links-list-page.vue") },
  {
    path: "/links/:id",
    name: "link-details",
    component: () => import("./details/link-details-page.vue"),
  },
];
