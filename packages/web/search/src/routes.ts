import type { RouteLocationNormalized, RouteRecordRaw } from "vue-router";

/**
 * The query a link to the search page carries: `/search?q=…`. The extension's popup opens such
 * links. `undefined` when there is none.
 */
export const queryOf = (route: Pick<RouteLocationNormalized, "query">): string | undefined => {
  const q = route.query["q"];
  return typeof q === "string" && q.trim() !== "" ? q : undefined;
};

/** The search page, mounted by `apps/web`. */
export const routes: ReadonlyArray<RouteRecordRaw> = [
  {
    path: "/search",
    name: "search",
    component: () => import("./search-page.vue"),
    props: (route) => {
      const query = queryOf(route);
      return query === undefined ? {} : { query };
    },
  },
];
