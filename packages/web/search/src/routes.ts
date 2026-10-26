import type { RouteRecordRaw } from "vue-router";

/** The search page, mounted by `apps/web`. */
export const routes: ReadonlyArray<RouteRecordRaw> = [
  { path: "/search", name: "search", component: () => import("./search-page.vue") },
];
