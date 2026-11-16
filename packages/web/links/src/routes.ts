import type { RouteRecordRaw } from "vue-router";

/**
 * The links feature: the feeds at `/links`, one link at `/links/:id`, and `/save?…&url=<link>`,
 * which Shortcuts and bookmarklets open to save a link (see `save/save-request.ts`).
 */
export const routes: ReadonlyArray<RouteRecordRaw> = [
  { path: "/links", name: "links", component: () => import("./list/links-list-page.vue") },
  { path: "/save", name: "save", component: () => import("./save/save-page.vue") },
  {
    path: "/links/:id",
    name: "link-details",
    component: () => import("./details/link-details-page.vue"),
  },
];
