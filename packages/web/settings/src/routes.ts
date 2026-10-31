import type { RouteRecordRaw } from "vue-router";

export const routes: ReadonlyArray<RouteRecordRaw> = [
  {
    path: "/settings",
    name: "settings",
    component: () => import("./settings-page.vue"),
    // `?add=device` opens the Add device dialog, for the pages that send people here to do that.
    props: (route) => ({ startAdding: route.query.add === "device" }),
  },
];
