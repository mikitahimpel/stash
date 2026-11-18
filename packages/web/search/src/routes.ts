import type { RouteRecordRaw } from "vue-router";

/**
 * Search has no page of its own: the field sits in the app header (`search-box.vue`) and its
 * results show in the Inbox (`/links?q=…`). `/search?q=…`, which the extension popup and old links
 * open, goes there with its query.
 */
export const routes: ReadonlyArray<RouteRecordRaw> = [
  {
    path: "/search",
    name: "search",
    redirect: (to) => ({ name: "links", query: to.query }),
  },
];
