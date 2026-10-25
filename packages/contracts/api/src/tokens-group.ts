import * as ApiToken from "@stash/contracts-domain/api-token";
import * as Device from "@stash/contracts-domain/device";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

export const CreateToken = Schema.Struct({
  deviceId: Device.DeviceId,
});
export type CreateToken = typeof CreateToken.Type;

export class TokensGroup extends HttpApiGroup.make("tokens")
  .add(
    HttpApiEndpoint.get("list", "/tokens", {
      success: Schema.Array(ApiToken.ApiTokenInfo),
    }),
    // The only response that ever carries the plaintext token.
    HttpApiEndpoint.post("create", "/tokens", {
      payload: CreateToken,
      success: ApiToken.CreatedApiToken.pipe(HttpApiSchema.status(201)),
      error: ErrorStatuses.NotFound,
    }),
    // Revokes the token. It stays listed with `revokedAt` set.
    HttpApiEndpoint.delete("revoke", "/tokens/:id", {
      params: { id: ApiToken.ApiTokenId },
      success: HttpApiSchema.NoContent,
      error: ErrorStatuses.NotFound,
    }),
  )
  .middleware(Security.Authorization) {}
