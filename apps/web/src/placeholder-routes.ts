import type { RouteRecordRaw } from "vue-router";

// Stand-ins for the `./routes` exports of the feature packages (`@stash/web-open-tabs/routes`,
// `@stash/web-settings/routes`), which don't exist yet. Each feature issue replaces its entry
// here with an import of the real `routes` in `app-router.ts`.

const placeholder = (path: string, name: string, title: string): RouteRecordRaw => ({
  path,
  name,
  component: () => import("./placeholder-page.vue"),
  props: { title },
});

export const openTabs: ReadonlyArray<RouteRecordRaw> = [
  placeholder("/open-now", "open-tabs", "Open now"),
];

export const settings: ReadonlyArray<RouteRecordRaw> = [
  placeholder("/settings", "settings", "Settings"),
];
