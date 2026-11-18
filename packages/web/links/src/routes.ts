import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { RouteRecordRaw } from "vue-router";

const listPage = () => import("./list/links-list-page.vue");

/**
 * The links feature: the feeds at `/links`, one link at `/links/:id`, and `/save?…&url=<link>`,
 * which Shortcuts and bookmarklets open to save a link (see `save/save-request.ts`).
 */
export const routes: ReadonlyArray<RouteRecordRaw> = [
  { path: "/links", name: "links", component: listPage },
  { path: "/save", name: "save", component: () => import("./save/save-page.vue") },
  {
    path: "/links/:id",
    name: "link-details",
    component: () => import("./details/link-details-page.vue"),
  },
];

/** Loads the Inbox's code ahead of the first visit. */
export const preload = (): void => void listPage();

/** Loads the Inbox's code and first data, for when the pointer is on its tab. */
export const prefetch = (registry: AtomRegistry.AtomRegistry): void => {
  preload();
  void import("./links-prefetch.ts").then((module) => module.run(registry));
};
