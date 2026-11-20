import * as Invite from "@stash/contracts-domain/invite";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
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
 * Whether `path` is served by a Worker rather than the app (the MCP sign-in's `/authorize/...`,
 * or the api's `/api/...`), so opening it is a full page load.
 */
export const isServerPath = (path: string): boolean => /^\/(authorize|api)(\/|\?|$)/.test(path);

/**
 * Whether `route` opens without a session: the login page, and pages that set `meta.public` (such
 * as the app's dev-only UI gallery).
 */
export const isPublic = (route: Pick<RouteLocationNormalized, "meta">): boolean =>
  route.meta["public"] === true;

/** The name of the route an invite link opens. */
export const invite = "invite";

const decodeInvite = Schema.decodeUnknownOption(Invite.InviteToken);

/** The invite token of an invite link's route, if it has the shape of one. */
export const inviteOf = (
  params: RouteLocationNormalized["params"],
): Invite.InviteToken | undefined => Option.getOrUndefined(decodeInvite(params["token"]));

const page = () => import("./login-page.vue");

export const routes: ReadonlyArray<RouteRecordRaw> = [
  { path: "/login", name: login, component: page, meta: { public: true } },
  // An invite link (`Invite.invitePath`): the login page, which signs a new GitHub account up
  // with the invite. Public, like the login page.
  {
    path: `${Invite.invitePath}:token`,
    name: invite,
    component: page,
    props: (route) => ({ invite: inviteOf(route.params) ?? null }),
    meta: { public: true },
  },
];
