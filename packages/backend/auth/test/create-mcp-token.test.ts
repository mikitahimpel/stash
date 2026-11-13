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
import * as AuthTestLayer from "./auth-test-layer.ts";

const allowedLogin = "synthetic-owner";

const TestLayer = ApiTokensRepo.layer.pipe(
  Layer.provideMerge(AuthTestLayer.layerDatabase),
  Layer.merge(Testing.layerStashConfig({ allowedGithubLogin: allowedLogin })),
);

describe("createMcpToken", () => {
  it.effect("mints a user token named Claude (MCP) and stores only its hash and login", () =>
    Effect.gen(function* () {
      const created = yield* CreateMcpToken.createMcpToken("Synthetic-Owner");
      expect(created.deviceId).toBeNull();
      expect(created.name).toBe(ApiToken.mcpTokenName);
      expect(Redacted.value(created.token).startsWith(ApiTokenSecret.prefix)).toBe(true);

      const rows = yield* D1Database.Database.use((db) =>
        db.all(D1Database.sql`SELECT device_id, name, github_login, hash FROM api_tokens`),
      );
      expect(rows).toEqual([
        {
          device_id: null,
          name: ApiToken.mcpTokenName,
          github_login: "Synthetic-Owner",
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
        },
      ]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("refuses a login other than the allowlisted one", () =>
    Effect.gen(function* () {
      const error = yield* CreateMcpToken.createMcpToken("synthetic-stranger").pipe(Effect.flip);
      expect(error).toBeInstanceOf(Errors.LoginNotAllowed);
      expect(yield* ListApiTokens.listApiTokens).toEqual([]);
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
      const created = yield* client.internal.createMcpToken({ payload: { login: allowedLogin } });
      expect(created.name).toBe(ApiToken.mcpTokenName);
      expect(Redacted.value(created.token)).not.toBe("");

      const error = yield* client.internal
        .createMcpToken({ payload: { login: "synthetic-stranger" } })
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(Errors.LoginNotAllowed);
    }).pipe(Effect.provide(server)),
  );
});
