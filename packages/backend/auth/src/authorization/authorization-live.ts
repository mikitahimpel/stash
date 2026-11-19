import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as ApiTokenSecret from "../api-tokens/api-token-secret.ts";
import * as ApiTokensRepo from "../api-tokens/api-tokens-repo.ts";
import * as SessionVerifier from "./session-verifier.ts";

// HttpApi runs the schemes in order (bearer, then session) and uses the first one that succeeds.
// A request without the scheme's credential decodes it as an empty string.

const unauthorized = (message: string) => new Errors.Unauthorized({ message });

const isEmpty = (credential: Redacted.Redacted<string>) => Redacted.value(credential) === "";

/** The `Authorization` middleware. Needs `ApiTokensRepo` and `SessionVerifier`. */
export const layer: Layer.Layer<
  Security.Authorization,
  never,
  ApiTokensRepo.ApiTokensRepo | SessionVerifier.SessionVerifier
> = Layer.effect(Security.Authorization)(
  Effect.gen(function* () {
    const repo = yield* ApiTokensRepo.ApiTokensRepo;
    const sessions = yield* SessionVerifier.SessionVerifier;

    const principalFor = Effect.fn("Authorization.bearer")(function* (
      token: Redacted.Redacted<string>,
    ) {
      if (isEmpty(token)) return yield* unauthorized("Missing bearer token");
      const hash = yield* ApiTokenSecret.hash(token);
      const stored = yield* repo.findByHash(hash).pipe(Effect.orDie);
      if (Option.isNone(stored) || !ApiTokenSecret.constantTimeEqual(stored.value.hash, hash)) {
        return yield* unauthorized("Invalid token");
      }
      if (stored.value.revokedAt !== null) return yield* unauthorized("Token revoked");
      // For the Connect page's status. Losing this write must not fail the request.
      yield* repo.touch(stored.value.id, yield* DateTime.now).pipe(Effect.ignore);
      const { deviceId, userId, role } = stored.value;
      // A device token acts for the device's owner, a user token (the MCP connector's) for the
      // user it was minted for.
      const principal: Security.Principal =
        deviceId !== null ? { kind: "device", deviceId } : { kind: "user" };
      return { principal, user: { id: userId, role } };
    });

    const userFor = (session: Redacted.Redacted<string>) =>
      isEmpty(session)
        ? Effect.fail(unauthorized("Missing session cookie"))
        : sessions.verify(session);

    // Both services come from the same credential, so a handler never sees a principal with
    // someone else's user.
    const provide = <A, E, R>(
      handler: Effect.Effect<A, E, R>,
      verified:
        | SessionVerifier.Verified
        | { principal: Security.Principal; user: SessionVerifier.Verified["user"] },
    ) =>
      handler.pipe(
        Effect.provideService(Security.CurrentPrincipal, verified.principal),
        Effect.provideService(Security.CurrentUser, verified.user),
      );

    return Security.Authorization.of({
      bearer: (handler, { credential }) =>
        Effect.flatMap(principalFor(credential), (verified) => provide(handler, verified)),
      session: (handler, { credential }) =>
        Effect.flatMap(userFor(credential), (verified) => provide(handler, verified)),
    });
  }),
);
