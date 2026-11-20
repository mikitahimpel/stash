import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import * as Effect from "effect/Effect";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";

/**
 * The ways to sign in are changed only from a signed-in browser: the request was authenticated
 * by the session cookie, not by an API token (a device's, or the MCP connector's user token,
 * which must not add a passkey to its user). `Authorization` tries the bearer token first, so a
 * request without one that got this far came with the session cookie. `Forbidden` otherwise.
 */
export const requireSession = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const principal = yield* Security.CurrentPrincipal;
    const bearer = request.headers["authorization"];
    const session = request.cookies[Security.sessionCookieName];
    if (principal.kind !== "user" || (bearer !== undefined && bearer !== "") || !session) {
      return yield* new Errors.Forbidden({
        message: "Sign-in methods can only be changed from the web app",
      });
    }
    return yield* Security.CurrentUser;
  });
