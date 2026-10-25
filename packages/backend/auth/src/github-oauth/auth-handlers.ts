import * as StashConfig from "@stash/backend-platform/stash-config";
import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as ApiTokenSecret from "../api-tokens/api-token-secret.ts";
import * as EndSession from "../sessions/end-session.ts";
import * as SessionsRepo from "../sessions/sessions-repo.ts";
import * as StartSession from "../sessions/start-session.ts";
import * as GithubClient from "./github-client.ts";
import * as OAuthState from "./oauth-state.ts";

// Database and cookie encoding failures are defects: the endpoints declare no error for them.

/** Attributes of every cookie this group sets. */
export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

/** The callback URL on this API, derived from the request so local dev and deploys both work. */
const callbackUrl = (request: HttpServerRequest.HttpServerRequest) =>
  HttpServerRequest.toURL(request).pipe(
    Option.map((url) => new URL("/auth/github/callback", url).toString()),
    Option.match({
      onNone: () => Effect.die(new Error("Cannot build the OAuth callback URL")),
      onSome: Effect.succeed,
    }),
  );

/**
 * The `auth` group of the `StashApi`: the GitHub OAuth login for the one allowlisted login, and
 * the session it starts. Needs `GithubClient`, `SessionsRepo`, `StashConfig` and the
 * `Authorization` middleware.
 */
export const layer = HttpApiBuilder.group(Api.StashApi, "auth", (handlers) =>
  Effect.gen(function* () {
    const github = yield* GithubClient.GithubClient;
    const config = yield* StashConfig.StashConfig;
    const repo = yield* SessionsRepo.SessionsRepo;
    const withRepo = Effect.provideService(SessionsRepo.SessionsRepo, repo);

    return handlers
      .handle("githubLogin", ({ request }) =>
        Effect.gen(function* () {
          const state = yield* OAuthState.generate;
          const location = github.authorizeUrl({ state, redirectUri: yield* callbackUrl(request) });
          return yield* HttpServerResponse.redirect(location, { status: 302 }).pipe(
            HttpServerResponse.setCookie(OAuthState.cookieName, state, {
              ...cookieOptions,
              path: OAuthState.cookiePath,
              maxAge: OAuthState.maxAge,
            }),
            Effect.orDie,
          );
        }),
      )
      .handle("githubCallback", ({ query, request }) =>
        Effect.gen(function* () {
          const expected = request.cookies[OAuthState.cookieName];
          if (expected === undefined || !ApiTokenSecret.constantTimeEqual(expected, query.state)) {
            return yield* new Errors.ValidationError({ message: "OAuth state does not match" });
          }
          const accessToken = yield* github.exchangeCode({
            code: query.code,
            redirectUri: yield* callbackUrl(request),
          });
          const login = yield* github.fetchLogin(accessToken);
          if (!GithubClient.sameLogin(login, config.allowedGithubLogin)) {
            return yield* new Errors.Forbidden({ message: "This GitHub login is not allowed" });
          }
          const session = yield* StartSession.startSession(login).pipe(withRepo, Effect.orDie);
          return yield* HttpServerResponse.redirect(`${config.webOrigin}/`, { status: 302 }).pipe(
            HttpServerResponse.setCookie(
              Security.sessionCookieName,
              Redacted.value(session.token),
              { ...cookieOptions, maxAge: StartSession.sessionTtl },
            ),
            Effect.flatMap(
              HttpServerResponse.expireCookie(OAuthState.cookieName, {
                ...cookieOptions,
                path: OAuthState.cookiePath,
              }),
            ),
            Effect.orDie,
          );
        }),
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
      );
  }),
);
