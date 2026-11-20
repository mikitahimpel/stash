import * as StashConfig from "@stash/backend-platform/stash-config";
import * as Errors from "@stash/contracts-domain/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SessionVerifier from "../authorization/session-verifier.ts";
import * as GithubClient from "../device-flow/github-client.ts";
import * as SessionToken from "./session-token.ts";
import * as SessionsRepo from "./sessions-repo.ts";

const unauthorized = (message: string) => new Errors.Unauthorized({ message });

/**
 * Accepts a session cookie whose session exists, has not expired and whose user still exists. An
 * owner's GitHub session must also still belong to the allowlisted login, so changing
 * `ALLOWED_GITHUB_LOGIN` signs the old owner out (a passkey or Google session of the owner is
 * theirs whatever the login is). Expired sessions are deleted on sight. Database
 * failures are defects.
 */
export const layer: Layer.Layer<
  SessionVerifier.SessionVerifier,
  never,
  SessionsRepo.SessionsRepo | StashConfig.StashConfig
> = Layer.effect(SessionVerifier.SessionVerifier)(
  Effect.gen(function* () {
    const repo = yield* SessionsRepo.SessionsRepo;
    const config = yield* StashConfig.StashConfig;
    return SessionVerifier.SessionVerifier.of({
      verify: Effect.fn("SessionVerifier.verify")(function* (session) {
        const id = yield* SessionToken.hash(session);
        const stored = yield* repo.find(id).pipe(Effect.orDie);
        if (Option.isNone(stored)) return yield* unauthorized("Unknown session");
        if (DateTime.isLessThanOrEqualTo(stored.value.expiresAt, yield* DateTime.now)) {
          yield* repo.remove(id).pipe(Effect.orDie);
          return yield* unauthorized("Session expired");
        }
        const { userId, role, method, githubLogin } = stored.value;
        if (
          role === "owner" &&
          method === "github" &&
          !GithubClient.sameLogin(githubLogin, config.allowedGithubLogin)
        ) {
          return yield* unauthorized("Login no longer allowed");
        }
        return {
          principal: githubLogin === "" ? { kind: "user" } : { kind: "user", login: githubLogin },
          user: { id: userId, role },
        } satisfies SessionVerifier.Verified;
      }),
    });
  }),
);
