import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { RouteRecordRaw } from "vue-router";

const page = () => import("./open-tabs-page.vue");

/** The "Open now" page. `apps/web` mounts these; the layout nav links to the `open-tabs` name. */
export const routes: ReadonlyArray<RouteRecordRaw> = [
  { path: "/open-now", name: "open-tabs", component: page },
];

/** Loads the page's code ahead of the first visit. */
export const preload = (): void => void page();

/** Loads the page's code and first data, for when the pointer is on its tab. */
export const prefetch = (registry: AtomRegistry.AtomRegistry): void => {
  preload();
  void import("./open-tabs-prefetch.ts").then((module) => module.run(registry));
};
