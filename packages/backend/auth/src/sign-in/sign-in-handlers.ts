import type * as GithubConfig from "@stash/backend-platform/github-config";
import type * as GoogleConfig from "@stash/backend-platform/google-config";
import * as ServiceContext from "@stash/backend-platform/service-context";
import type * as StashConfig from "@stash/backend-platform/stash-config";
import type * as InvitesRepo from "@stash/backend-users/invites-repo";
import type * as UsersRepo from "@stash/backend-users/users-repo";
import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as SignInGroup from "@stash/contracts-api/sign-in";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as AuthHandlers from "../device-flow/auth-handlers.ts";
import type * as DeviceFlowsStore from "../device-flow/device-flows-store.ts";
import type * as GithubClient from "../device-flow/github-client.ts";
import * as GoogleClient from "../google/google-client.ts";
import type * as GoogleFlowsStore from "../google/google-flows-store.ts";
import * as GoogleSignIn from "../google/google-sign-in.ts";
import * as LinkGithub from "../methods/link-github.ts";
import * as SignInMethods from "../methods/sign-in-methods.ts";
import * as PasskeyCeremonies from "../passkeys/passkey-ceremonies.ts";
import type * as PasskeyChallenges from "../passkeys/passkey-challenges.ts";
import type * as PasskeysRepo from "../passkeys/passkeys-repo.ts";
import type * as SessionsRepo from "../sessions/sessions-repo.ts";
import * as StartSession from "../sessions/start-session.ts";
import * as RequireSession from "./require-session.ts";
import * as SignInRateLimiter from "./sign-in-rate-limiter.ts";

// Database, KV and cookie encoding failures are defects: the endpoints declare no error for them.

const encodeSignedIn = Schema.encodeEffect(SignInGroup.SignedIn);

/** Answers `signedIn` with the new session's cookie. */
const withSession = (session: Effect.Success<ReturnType<typeof StartSession.startSession>>) =>
  Effect.gen(function* () {
    const body = yield* encodeSignedIn({ me: { kind: "user" } }).pipe(Effect.orDie);
    return yield* HttpServerResponse.jsonUnsafe(body).pipe(
      HttpServerResponse.setCookie(Security.sessionCookieName, Redacted.value(session.token), {
        ...AuthHandlers.cookieOptions,
        maxAge: StartSession.sessionTtl,
      }),
      Effect.orDie,
    );
  });

const bindingCookie = (response: HttpServerResponse.HttpServerResponse, binding: string) =>
  response.pipe(
    HttpServerResponse.setCookie(GoogleSignIn.bindingCookieName, binding, {
      ...AuthHandlers.cookieOptions,
      maxAge: Duration.minutes(10),
    }),
    Effect.orDie,
  );

/**
 * The `signIn` group of the `StashApi`: passkeys, Google, and the linked ways to sign in. Needs
 * the passkeys, Google and device flow services, `SessionsRepo`, `UsersRepo`, `InvitesRepo`, the
 * configs, `SignInRateLimiter` and the `Authorization` middleware.
 */
export const layer = HttpApiBuilder.group(Api.StashApi, "signIn", (handlers) =>
  Effect.gen(function* () {
    const context = yield* ServiceContext.capture<
      | PasskeysRepo.PasskeysRepo
      | PasskeyChallenges.PasskeyChallenges
      | GoogleClient.GoogleClient
      | GoogleFlowsStore.GoogleFlowsStore
      | GithubClient.GithubClient
      | DeviceFlowsStore.DeviceFlowsStore
      | SessionsRepo.SessionsRepo
      | UsersRepo.UsersRepo
      | InvitesRepo.InvitesRepo
      | StashConfig.StashConfig
      | GoogleConfig.GoogleConfig
      | GithubConfig.GithubConfig
    >();
    const limiter = yield* SignInRateLimiter.SignInRateLimiter;
    const withContext = Effect.provideContext(context);
    const ipOf = (request: { readonly headers: Record<string, string | undefined> }) =>
      request.headers[AuthHandlers.clientIpHeader] ?? "unknown";

    return handlers
      .handle("providers", () => SignInMethods.providers.pipe(withContext))
      .handle("passkeyOptions", ({ request }) =>
        Effect.gen(function* () {
          yield* limiter.consume("passkey", ipOf(request));
          return yield* PasskeyCeremonies.signInOptions().pipe(withContext);
        }),
      )
      .handle("passkeySignIn", ({ request, payload }) =>
        Effect.gen(function* () {
          yield* limiter.consume("passkey", ipOf(request));
          const user = yield* PasskeyCeremonies.signIn(
            payload.challengeId,
            payload.credential,
          ).pipe(withContext);
          const session = yield* StartSession.startSession(user.id, { method: "passkey" }).pipe(
            withContext,
            Effect.orDie,
          );
          return yield* withSession(session);
        }),
      )
      .handle("passkeySignUpOptions", ({ request, payload }) =>
        Effect.gen(function* () {
          yield* limiter.consume("passkey-sign-up", ipOf(request));
          return yield* PasskeyCeremonies.signUpOptions(payload.invite).pipe(withContext);
        }),
      )
      .handle("passkeySignUp", ({ request, payload }) =>
        Effect.gen(function* () {
          yield* limiter.consume("passkey-sign-up", ipOf(request));
          const user = yield* PasskeyCeremonies.signUp(
            payload.challengeId,
            payload.invite,
            payload.credential,
            payload.displayName,
          ).pipe(withContext);
          const session = yield* StartSession.startSession(user.id, { method: "passkey" }).pipe(
            withContext,
            Effect.orDie,
          );
          return yield* withSession(session);
        }),
      )
      .handle("googleStart", ({ request, query }) =>
        Effect.gen(function* () {
          yield* limiter.consume("google", ipOf(request));
          const started = yield* GoogleSignIn.start({
            redirect: query.redirect,
            invite: query.invite,
          }).pipe(withContext);
          return yield* bindingCookie(
            HttpServerResponse.redirect(started.location, { status: 302 }),
            Redacted.value(started.binding),
          );
        }),
      )
      .handle("googleCallback", ({ request, query }) =>
        Effect.gen(function* () {
          const outcome = yield* GoogleSignIn.callback(
            query,
            request.cookies[GoogleSignIn.bindingCookieName],
          ).pipe(withContext);
          let response = yield* HttpServerResponse.redirect(outcome.location, {
            status: 302,
          }).pipe(
            HttpServerResponse.expireCookie(
              GoogleSignIn.bindingCookieName,
              AuthHandlers.cookieOptions,
            ),
            Effect.orDie,
          );
          if (outcome.session !== undefined) {
            response = yield* response.pipe(
              HttpServerResponse.setCookie(
                Security.sessionCookieName,
                Redacted.value(outcome.session.token),
                { ...AuthHandlers.cookieOptions, maxAge: StartSession.sessionTtl },
              ),
              Effect.orDie,
            );
          }
          return response;
        }),
      )
      .handle("methods", ({ request }) =>
        Effect.gen(function* () {
          yield* RequireSession.requireSession(request);
          return yield* SignInMethods.list.pipe(withContext);
        }),
      )
      .handle("passkeyAddOptions", ({ request }) =>
        Effect.gen(function* () {
          yield* RequireSession.requireSession(request);
          return yield* PasskeyCeremonies.addOptions().pipe(withContext);
        }),
      )
      .handle("passkeyAdd", ({ request, payload }) =>
        Effect.gen(function* () {
          yield* RequireSession.requireSession(request);
          return yield* PasskeyCeremonies.add(
            payload.challengeId,
            payload.credential,
            payload.name,
          ).pipe(withContext);
        }),
      )
      .handle("passkeyRemove", ({ request, params }) =>
        Effect.gen(function* () {
          yield* RequireSession.requireSession(request);
          yield* SignInMethods.removePasskey(params.id).pipe(withContext);
        }),
      )
      .handle("googleLink", ({ request, payload }) =>
        Effect.gen(function* () {
          const user = yield* RequireSession.requireSession(request);
          const started = yield* GoogleSignIn.start({
            redirect: payload.redirect,
            linkUserId: user.id,
          }).pipe(withContext);
          return yield* bindingCookie(
            HttpServerResponse.jsonUnsafe({ url: started.location }),
            Redacted.value(started.binding),
          );
        }),
      )
      .handle("githubLink", ({ request, payload }) =>
        Effect.gen(function* () {
          yield* RequireSession.requireSession(request);
          return yield* LinkGithub.linkGithub(payload.flowId).pipe(withContext);
        }),
      )
      .handle("accountRemove", ({ request, params }) =>
        Effect.gen(function* () {
          yield* RequireSession.requireSession(request);
          yield* SignInMethods.removeAccount(params.id).pipe(withContext);
        }),
      );
  }),
);
