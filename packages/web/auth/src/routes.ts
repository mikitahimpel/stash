import type { RouteLocationNormalized, RouteRecordRaw } from "vue-router";

/** The name of the login route. The guard redirects there when nobody is signed in. */
export const login = "login";

/** Whether `route` opens without a session. Only the login page does. */
export const isPublic = (route: Pick<RouteLocationNormalized, "meta">): boolean =>
  route.meta["public"] === true;

export const routes: ReadonlyArray<RouteRecordRaw> = [
  {
    path: "/login",
    name: login,
    component: () => import("./login-page.vue"),
    meta: { public: true },
  },
];
