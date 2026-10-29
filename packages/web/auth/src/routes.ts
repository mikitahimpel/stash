import type {
  LocationQuery,
  RouteLocationNormalized,
  RouteLocationRaw,
  RouteRecordRaw,
} from "vue-router";

/** The name of the login route. The guard redirects there when nobody is signed in. */
export const login = "login";

/** The login page's query parameter that holds the path to open once signed in. */
export const returnParam = "redirect";

/** The login page, set to come back to `path` (the page the user wanted) once signed in. */
export const loginFor = (path: string): RouteLocationRaw => ({
  name: login,
  query: path === "/" ? {} : { [returnParam]: path },
});

/**
 * The path to open once signed in, from the login page's `query`. Only a path inside the app
 * counts (`/...`, not `//host/...`), anything else opens the start page.
 */
export const returnTo = (query: LocationQuery): string => {
  const value = query[returnParam];
  const path = typeof value === "string" ? value : undefined;
  return path !== undefined && path.startsWith("/") && !path.startsWith("//") ? path : "/";
};

/**
 * Whether `route` opens without a session: the login page, and pages that set `meta.public` (such
 * as the app's dev-only UI gallery).
 */
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
