import type { RouteRecordRaw } from "vue-router";

export const routes: ReadonlyArray<RouteRecordRaw> = [
  { path: "/settings", name: "settings", component: () => import("./settings-page.vue") },
];
