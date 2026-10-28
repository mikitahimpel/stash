import * as StashConfig from "@stash/backend-platform/stash-config";
import * as Api from "@stash/contracts-api/api";
import * as AuthGroup from "@stash/contracts-api/auth";
import * as Security from "@stash/contracts-api/security";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as EndSession from "../sessions/end-session.ts";
import * as SessionsRepo from "../sessions/sessions-repo.ts";
import * as StartSession from "../sessions/start-session.ts";
import * as DeviceFlowsStore from "./device-flows-store.ts";
import * as DeviceStartRateLimiter from "./device-start-rate-limiter.ts";
import * as GithubClient from "./github-client.ts";
import * as PollDeviceFlow from "./poll-device-flow.ts";
import * as StartDeviceFlow from "./start-device-flow.ts";

// Database, KV and cookie encoding failures are defects: the endpoints declare no error for them.

/** Attributes of every cookie this group sets. */
export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

// `complete` sets the session cookie, so it answers with its own response, encoded as the
// contract's `DeviceFlowStatus`.
const encodeStatus = (status: AuthGroup.DeviceFlowStatus) =>
  Schema.encodeEffect(AuthGroup.DeviceFlowStatus)(status).pipe(Effect.orDie);

/** Cloudflare puts the client's address in this header. */
export const clientIpHeader = "cf-connecting-ip";

/**
 * The `auth` group of the `StashApi`: the GitHub Device Flow login for the one allowlisted login,
 * and the session it starts. Needs `GithubClient`, `DeviceFlowsStore`, `DeviceStartRateLimiter`,
 * `SessionsRepo`, `StashConfig` and the `Authorization` middleware.
 */
export const layer = HttpApiBuilder.group(Api.StashApi, "auth", (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<
      | GithubClient.GithubClient
      | DeviceFlowsStore.DeviceFlowsStore
      | SessionsRepo.SessionsRepo
      | StashConfig.StashConfig
    >();
    const limiter = yield* DeviceStartRateLimiter.DeviceStartRateLimiter;
    const withContext = Effect.provideContext(context);

    return handlers
      .handle("deviceStart", ({ request }) =>
        Effect.gen(function* () {
          yield* limiter
            .consume(request.headers[clientIpHeader] ?? "unknown")
            .pipe(Effect.catchTag("KvError", Effect.die));
          return yield* StartDeviceFlow.startDeviceFlow().pipe(withContext);
        }),
      )
      .handle("devicePoll", ({ payload }) =>
        Effect.gen(function* () {
          const outcome = yield* PollDeviceFlow.pollDeviceFlow(payload.flowId).pipe(withContext);
          if (outcome.status !== "complete") return outcome;
          const complete = yield* encodeStatus({ status: "complete", me: { kind: "user" } });
          return yield* HttpServerResponse.jsonUnsafe(complete).pipe(
            HttpServerResponse.setCookie(
              Security.sessionCookieName,
              Redacted.value(outcome.session.token),
              { ...cookieOptions, maxAge: StartSession.sessionTtl },
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
            yield* EndSession.endSession(Redacted.make(session)).pipe(withContext, Effect.orDie);
          }
          return yield* HttpServerResponse.empty({ status: 204 }).pipe(
            HttpServerResponse.expireCookie(Security.sessionCookieName, cookieOptions),
            Effect.orDie,
          );
        }),
      );
  }),
);
