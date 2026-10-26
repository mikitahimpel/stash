import type { RouteRecordRaw } from "vue-router";

// Stand-ins for the `./routes` exports of the feature packages (`@stash/web-links/routes`,
// `@stash/web-search/routes`, ...), which don't exist yet. Each feature issue replaces its entry
// here with an import of the real `routes` in `app-router.ts`.

const placeholder = (path: string, name: string, title: string): RouteRecordRaw => ({
  path,
  name,
  component: () => import("./placeholder-page.vue"),
  props: { title },
});

export const links: ReadonlyArray<RouteRecordRaw> = [placeholder("/links", "links", "Links")];

export const settings: ReadonlyArray<RouteRecordRaw> = [
  placeholder("/settings", "settings", "Settings"),
];
