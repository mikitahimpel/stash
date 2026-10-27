import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Redacted from "effect/Redacted";
import * as EndSession from "../sessions/end-session.ts";
import * as SessionsRepo from "../sessions/sessions-repo.ts";

// Database and cookie encoding failures are defects: the endpoints declare no error for them.

/** Attributes of every cookie this group sets. */
export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

/**
 * The `auth` group of the `StashApi`: the session of the one allowlisted GitHub login. Needs
 * `SessionsRepo` and the `Authorization` middleware.
 */
export const layer = HttpApiBuilder.group(Api.StashApi, "auth", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* SessionsRepo.SessionsRepo;
    const withRepo = Effect.provideService(SessionsRepo.SessionsRepo, repo);

    return (
      handlers
        // The redirect login was replaced by the GitHub Device Flow in the contract. Until the
        // backend implements it (#115) both endpoints answer 500.
        .handle("deviceStart", () =>
          Effect.die(new Error("GitHub Device Flow login is not implemented")),
        )
        .handle("devicePoll", () =>
          Effect.die(new Error("GitHub Device Flow login is not implemented")),
        )
        .handle("me", () => Effect.service(Security.CurrentPrincipal))
        .handle("logout", ({ request }) =>
          Effect.gen(function* () {
            const session = request.cookies[Security.sessionCookieName];
            if (session !== undefined && session !== "") {
              yield* EndSession.endSession(Redacted.make(session)).pipe(withRepo, Effect.orDie);
            }
            return yield* HttpServerResponse.empty({ status: 204 }).pipe(
              HttpServerResponse.expireCookie(Security.sessionCookieName, cookieOptions),
              Effect.orDie,
            );
          }),
        )
    );
  }),
);
