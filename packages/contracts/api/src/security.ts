import * as Device from "@stash/contracts-domain/device";
import { Context, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";

/**
 * The signed-in user, authenticated by the web session cookie. `login` is their GitHub login, when
 * the session knows it (the web header shows its initial).
 */
export const UserPrincipal = Schema.Struct({
  kind: Schema.Literal("user"),
  login: Schema.optionalKey(Schema.String),
});
export type UserPrincipal = typeof UserPrincipal.Type;

/** A device, authenticated by its API token. */
export const DevicePrincipal = Schema.Struct({
  kind: Schema.Literal("device"),
  deviceId: Device.DeviceId,
});
export type DevicePrincipal = typeof DevicePrincipal.Type;

/** Who is calling, discriminated by `kind`. */
export const Principal = Schema.Union([UserPrincipal, DevicePrincipal]);
export type Principal = typeof Principal.Type;

/** Provided by `Authorization` to every endpoint it guards. */
export class CurrentPrincipal extends Context.Service<CurrentPrincipal, Principal>()(
  "@stash/contracts-api/security/CurrentPrincipal",
) {}

/** Name of the cookie that carries the web session. */
export const sessionCookieName = "stash_session";

/**
 * Authenticates a request by a bearer API token (`Authorization: Bearer <token>`) or by the session
 * cookie, in that order. The server implements one handler per scheme. Clients must provide a
 * client middleware too: token clients attach the bearer token, and the browser forwards the
 * request as is because it sends the cookie itself.
 */
export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentPrincipal }
>()("@stash/contracts-api/security/Authorization", {
  requiredForClient: true,
  security: {
    bearer: HttpApiSecurity.bearer,
    session: HttpApiSecurity.apiKey({ key: sessionCookieName, in: "cookie" }),
  },
  error: ErrorStatuses.Unauthorized,
}) {}
