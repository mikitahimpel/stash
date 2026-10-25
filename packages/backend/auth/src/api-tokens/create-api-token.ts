import * as ApiToken from "@stash/contracts-domain/api-token";
import type * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as ApiTokenSecret from "./api-token-secret.ts";
import * as ApiTokensRepo from "./api-tokens-repo.ts";

/**
 * Issues a token for a device. Only the hash is stored. The plaintext is in the result and is
 * never readable again.
 */
export const createApiToken = Effect.fn("createApiToken")(function* (deviceId: Device.DeviceId) {
  const repo = yield* ApiTokensRepo.ApiTokensRepo;
  if (!(yield* repo.deviceExists(deviceId))) {
    return yield* new Errors.NotFound({ resource: "device", id: deviceId });
  }
  const token = yield* ApiTokenSecret.generate;
  const info = yield* repo.insert({
    id: ApiToken.ApiTokenId.make(crypto.randomUUID()),
    deviceId,
    hash: yield* ApiTokenSecret.hash(token),
    createdAt: yield* DateTime.now,
  });
  return { ...info, token } satisfies ApiToken.CreatedApiToken;
});
