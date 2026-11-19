import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as ApiToken from "@stash/contracts-domain/api-token";
import * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as ApiTokenSecret from "../src/api-tokens/api-token-secret.ts";
import * as ApiTokensRepo from "../src/api-tokens/api-tokens-repo.ts";
import * as CreateApiToken from "../src/api-tokens/create-api-token.ts";
import * as ListApiTokens from "../src/api-tokens/list-api-tokens.ts";
import * as RevokeApiToken from "../src/api-tokens/revoke-api-token.ts";
import * as AuthTestLayer from "./auth-test-layer.ts";

const TestLayer = ApiTokensRepo.layer.pipe(Layer.provideMerge(AuthTestLayer.layerDatabase));

describe("API tokens", () => {
  it.effect("stores only the hash of a created token", () =>
    Effect.gen(function* () {
      const created = yield* CreateApiToken.createApiToken(AuthTestLayer.deviceId);
      const plaintext = Redacted.value(created.token);

      const rows = yield* D1Database.Database.use((db) =>
        db.all(D1Database.sql`SELECT * FROM api_tokens`),
      );
      expect(rows).toEqual([
        {
          id: created.id,
          user_id: Testing.owner.id,
          device_id: AuthTestLayer.deviceId,
          name: null,
          hash: yield* ApiTokenSecret.hash(created.token),
          created_at: DateTime.formatIso(created.createdAt),
          revoked_at: null,
          last_used_at: null,
        },
      ]);
      for (const value of Object.values(rows[0] ?? {})) {
        expect(String(value)).not.toContain(plaintext);
      }
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("lists tokens without secrets, oldest first", () =>
    Effect.gen(function* () {
      const first = yield* CreateApiToken.createApiToken(AuthTestLayer.deviceId);
      yield* TestClock.adjust("1 second");
      const second = yield* CreateApiToken.createApiToken(AuthTestLayer.deviceId);

      const listed = yield* ListApiTokens.listApiTokens;
      expect(listed.map((token) => token.id)).toEqual([first.id, second.id]);
      expect(listed[0]).toEqual({
        id: first.id,
        deviceId: AuthTestLayer.deviceId,
        name: null,
        createdAt: first.createdAt,
        revokedAt: null,
        lastUsedAt: null,
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("records the last use at most once a minute", () =>
    Effect.gen(function* () {
      const created = yield* CreateApiToken.createApiToken(AuthTestLayer.deviceId);
      const repo = yield* ApiTokensRepo.ApiTokensRepo;
      const lastUsed = ListApiTokens.listApiTokens.pipe(
        Effect.map((tokens) => tokens[0]?.lastUsedAt),
      );

      const first = yield* DateTime.now;
      yield* repo.touch(created.id, first);
      expect(yield* lastUsed).toEqual(first);

      yield* repo.touch(created.id, DateTime.add(first, { seconds: 30 }));
      expect(yield* lastUsed).toEqual(first);

      const later = DateTime.add(first, { seconds: 61 });
      yield* repo.touch(created.id, later);
      expect(yield* lastUsed).toEqual(later);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects a token for an unknown device", () =>
    Effect.gen(function* () {
      const error = yield* CreateApiToken.createApiToken(
        Device.DeviceId.make("device-missing"),
      ).pipe(Effect.flip);
      expect(error).toEqual(new Errors.NotFound({ resource: "device", id: "device-missing" }));
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("revokes a token once and keeps it listed", () =>
    Effect.gen(function* () {
      const created = yield* CreateApiToken.createApiToken(AuthTestLayer.deviceId);
      yield* TestClock.adjust("1 minute");
      const revoked = yield* RevokeApiToken.revokeApiToken(created.id);
      expect(revoked.revokedAt).toEqual(DateTime.add(created.createdAt, { minutes: 1 }));

      yield* TestClock.adjust("1 minute");
      const again = yield* RevokeApiToken.revokeApiToken(created.id);
      expect(again.revokedAt).toEqual(revoked.revokedAt);
      expect(yield* ListApiTokens.listApiTokens).toEqual([revoked]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("fails to revoke an unknown token", () =>
    Effect.gen(function* () {
      const error = yield* RevokeApiToken.revokeApiToken(ApiToken.ApiTokenId.make("nope")).pipe(
        Effect.flip,
      );
      expect(error).toEqual(new Errors.NotFound({ resource: "token", id: "nope" }));
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("keeps each user's tokens to that user", () =>
    Effect.gen(function* () {
      const asMember = Testing.as(Testing.member);
      const mine = yield* CreateApiToken.createApiToken(AuthTestLayer.deviceId);
      const theirs = yield* CreateApiToken.createApiToken(AuthTestLayer.memberDeviceId).pipe(
        asMember,
      );
      expect((yield* ListApiTokens.listApiTokens).map((token) => token.id)).toEqual([mine.id]);
      expect((yield* ListApiTokens.listApiTokens.pipe(asMember)).map((token) => token.id)).toEqual([
        theirs.id,
      ]);
      // No token for a device of someone else, and no revoking a token of someone else.
      expect(
        yield* CreateApiToken.createApiToken(AuthTestLayer.deviceId).pipe(asMember, Effect.flip),
      ).toEqual(new Errors.NotFound({ resource: "device", id: AuthTestLayer.deviceId }));
      expect(yield* RevokeApiToken.revokeApiToken(mine.id).pipe(asMember, Effect.flip)).toEqual(
        new Errors.NotFound({ resource: "token", id: mine.id }),
      );
      expect((yield* ListApiTokens.listApiTokens)[0]?.revokedAt).toBeNull();
    }).pipe(Effect.provide(TestLayer)),
  );
});
