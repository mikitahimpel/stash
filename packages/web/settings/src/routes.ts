import * as ConnectStatus from "@stash/web-connect/connect-status";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { RouteRecordRaw } from "vue-router";

const page = () => import("./settings-page.vue");

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
    component: page,
    props: (route) => (isSource(route.query.guide) ? { guide: route.query.guide } : {}),
  },
];

/** Loads the page's code ahead of the first visit. */
export const preload = (): void => void page();

/** Loads the page's code and first data, for when the pointer is on its tab. */
export const prefetch = (registry: AtomRegistry.AtomRegistry): void => {
  preload();
  void import("./settings-prefetch.ts").then((module) => module.run(registry));
};
