import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as ApiToken from "@stash/contracts-domain/api-token";
import * as Errors from "@stash/contracts-domain/errors";
import * as InternalApi from "@stash/contracts-api/internal-api";
import * as Effect from "effect/Effect";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApiTest from "effect/http-api/HttpApiTest";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as ApiTokenSecret from "../src/api-tokens/api-token-secret.ts";
import * as ApiTokensRepo from "../src/api-tokens/api-tokens-repo.ts";
import * as ListApiTokens from "../src/api-tokens/list-api-tokens.ts";
import * as CreateMcpToken from "../src/mcp-tokens/create-mcp-token.ts";
import * as InternalHandlers from "../src/mcp-tokens/internal-handlers.ts";
import * as SessionVerifierLive from "../src/sessions/session-verifier-live.ts";
import * as SessionsRepo from "../src/sessions/sessions-repo.ts";
import * as StartSession from "../src/sessions/start-session.ts";
import * as AuthTestLayer from "./auth-test-layer.ts";

const allowedLogin = "synthetic-owner";

const TestLayer = Layer.mergeAll(
  ApiTokensRepo.layer,
  SessionVerifierLive.layer.pipe(Layer.provideMerge(SessionsRepo.layer)),
).pipe(
  Layer.provideMerge(AuthTestLayer.layerDatabase),
  Layer.provideMerge(Testing.layerStashConfig({ allowedGithubLogin: allowedLogin })),
);

describe("createMcpToken", () => {
  it.effect("mints a user token named Claude (MCP) for the owner and stores only its hash", () =>
    Effect.gen(function* () {
      const created = yield* CreateMcpToken.createMcpToken({
        id: "1001",
        login: "Synthetic-Owner",
      });
      expect(created.deviceId).toBeNull();
      expect(created.name).toBe(ApiToken.mcpTokenName);
      expect(Redacted.value(created.token).startsWith(ApiTokenSecret.prefix)).toBe(true);

      const rows = yield* D1Database.Database.use((db) =>
        db.all(D1Database.sql`SELECT device_id, name, user_id, hash FROM api_tokens`),
      );
      expect(rows).toEqual([
        {
          device_id: null,
          name: ApiToken.mcpTokenName,
          user_id: Testing.owner.id,
          hash: yield* ApiTokenSecret.hash(created.token),
        },
      ]);
      expect(yield* ListApiTokens.listApiTokens).toEqual([
        {
          id: created.id,
          deviceId: null,
          name: ApiToken.mcpTokenName,
          createdAt: created.createdAt,
          revokedAt: null,
          lastUsedAt: null,
        },
      ]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("refuses an account that is neither the owner nor a member", () =>
    Effect.gen(function* () {
      const error = yield* CreateMcpToken.createMcpToken({
        id: "2002",
        login: "synthetic-stranger",
      }).pipe(Effect.flip);
      expect(error).toBeInstanceOf(Errors.LoginNotAllowed);
      expect(yield* ListApiTokens.listApiTokens).toEqual([]);
      expect(yield* ListApiTokens.listApiTokens.pipe(Testing.as(Testing.member))).toEqual([]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("mints a member's token for that member, found by the account's id", () =>
    Effect.gen(function* () {
      yield* D1Database.Database.use((db) =>
        db.run(
          D1Database.sql`INSERT INTO user_identities (provider, subject, user_id, label)
            VALUES (${"github"}, ${"3003"}, ${Testing.member.id}, ${"synthetic-member"})`,
        ),
      );
      // The login was renamed since: the id still finds the member.
      const created = yield* CreateMcpToken.createMcpToken({ id: "3003", login: "renamed" });
      expect(
        (yield* ListApiTokens.listApiTokens.pipe(Testing.as(Testing.member))).map((t) => t.id),
      ).toEqual([created.id]);
      // It is not the owner's token, and the owner does not see it.
      expect(yield* ListApiTokens.listApiTokens).toEqual([]);
      // A stranger who took the member's old login gets nothing.
      const error = yield* CreateMcpToken.createMcpToken({
        id: "4004",
        login: "synthetic-member",
      }).pipe(Effect.flip);
      expect(error).toBeInstanceOf(Errors.LoginNotAllowed);
    }).pipe(Effect.provide(TestLayer)),
  );
});

describe("internal handlers", () => {
  const server = InternalHandlers.layer.pipe(
    Layer.provideMerge(TestLayer),
    Layer.merge(HttpServer.layerServices),
  );

  it.effect("serves POST /internal/mcp-tokens without any credential", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(InternalApi.InternalApi, ["internal"]);
      const created = yield* client.internal.createMcpToken({
        payload: { login: allowedLogin, githubId: "1001" },
      });
      expect(created.name).toBe(ApiToken.mcpTokenName);
      expect(Redacted.value(created.token)).not.toBe("");

      const error = yield* client.internal
        .createMcpToken({ payload: { login: "synthetic-stranger", githubId: "2002" } })
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(Errors.LoginNotAllowed);
    }).pipe(Effect.provide(server)),
  );

  it.effect("mints the token of a web session's user, and refuses an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* StartSession.startSession(Testing.member.id, { method: "passkey" });
      const client = yield* HttpApiTest.groups(InternalApi.InternalApi, ["internal"]);
      const created = yield* client.internal.createMcpTokenForSession({
        payload: { session: Redacted.value(session.token) },
      });
      expect(created.userId).toBe(Testing.member.id);
      expect(created.name).toBe(ApiToken.mcpTokenName);
      expect(
        (yield* ListApiTokens.listApiTokens.pipe(Testing.as(Testing.member))).map((t) => t.id),
      ).toEqual([created.id]);
      expect(yield* ListApiTokens.listApiTokens).toEqual([]);

      const error = yield* client.internal
        .createMcpTokenForSession({ payload: { session: "synthetic-unknown-session" } })
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(Errors.Unauthorized);
    }).pipe(Effect.provide(server)),
  );
});
