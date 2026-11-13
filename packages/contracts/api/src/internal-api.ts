import * as ApiToken from "@stash/contracts-domain/api-token";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";

// The api's internal surface, for other Workers of this app only. `apps/api` serves it on a named
// entrypoint that only a Service Binding can reach, never on its public `fetch` (the
// `*.workers.dev` route and the web Worker's `/api/*` proxy). It has no `Authorization`
// middleware: reaching it at all is the credential.

/** Mint an api token for the user the MCP server just signed in with GitHub. */
export const CreateMcpToken = Schema.Struct({
  /** The GitHub login the MCP OAuth flow verified. The api checks it against its allowlist. */
  login: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
});
export type CreateMcpToken = typeof CreateMcpToken.Type;

export class InternalGroup extends HttpApiGroup.make("internal").add(
  // A user token named `Claude (MCP)`: listed and revocable in Settings like any token. The only
  // response besides `tokens.create` that carries a plaintext token.
  HttpApiEndpoint.post("createMcpToken", "/internal/mcp-tokens", {
    payload: CreateMcpToken,
    success: ApiToken.CreatedApiToken.pipe(HttpApiSchema.status(201)),
    error: ErrorStatuses.LoginNotAllowed,
  }),
) {}

/** The internal HTTP API. Only `apps/api`'s binding entrypoint serves it. */
export class InternalApi extends HttpApi.make("stash-internal")
  .add(InternalGroup)
  .annotateMerge(OpenApi.annotations({ title: "Stash internal API" })) {}
