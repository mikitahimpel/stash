import * as ApiToken from "@stash/contracts-domain/api-token";
import * as User from "@stash/contracts-domain/user";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";

// The api's internal surface, for other Workers of this app only. `apps/api` serves it on a named
// entrypoint that only a Service Binding can reach, never on its public `fetch` (the
// `*.workers.dev` route and the web Worker's `/api/*` proxy). It has no `Authorization`
// middleware: reaching it at all is the credential.

/** Mint an api token for the user the MCP server just signed in with GitHub. */
export const CreateMcpToken = Schema.Struct({
  /** The GitHub login the MCP OAuth flow verified. */
  login: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  /**
   * The numeric id of that GitHub account, as text. A login can be renamed and taken by someone
   * else; the id cannot, so the api finds the Stash account by it. `LoginNotAllowed` if there is
   * none (Claude never signs anyone up: that takes an invite, in the web app).
   */
  githubId: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
});
export type CreateMcpToken = typeof CreateMcpToken.Type;

/** Mint an api token for the user of a web session (the MCP sign-in on the site's own host). */
export const CreateMcpTokenForSession = Schema.Struct({
  /** The `stash_session` cookie the browser sent to the MCP sign-in page. */
  session: Schema.String.pipe(Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(512))),
});
export type CreateMcpTokenForSession = typeof CreateMcpTokenForSession.Type;

/** The token, and whose it is (the grant's user id). */
export const McpTokenForSession = Schema.Struct({
  ...ApiToken.CreatedApiToken.fields,
  userId: User.UserId,
});
export type McpTokenForSession = typeof McpTokenForSession.Type;

export class InternalGroup extends HttpApiGroup.make("internal").add(
  // A user token named `Claude (MCP)`: listed and revocable in Settings like any token. The only
  // response besides `tokens.create` that carries a plaintext token.
  HttpApiEndpoint.post("createMcpToken", "/internal/mcp-tokens", {
    payload: CreateMcpToken,
    success: ApiToken.CreatedApiToken.pipe(HttpApiSchema.status(201)),
    error: ErrorStatuses.LoginNotAllowed,
  }),
  // The same token, for whoever the web session signs in (a passkey, Google or GitHub sign-in on
  // the web origin, which the MCP server shares on a custom domain). `Unauthorized` for a session
  // that is unknown or expired.
  HttpApiEndpoint.post("createMcpTokenForSession", "/internal/mcp-tokens/session", {
    payload: CreateMcpTokenForSession,
    success: McpTokenForSession.pipe(HttpApiSchema.status(201)),
    error: ErrorStatuses.Unauthorized,
  }),
) {}

/** The internal HTTP API. Only `apps/api`'s binding entrypoint serves it. */
export class InternalApi extends HttpApi.make("stash-internal")
  .add(InternalGroup)
  .annotateMerge(OpenApi.annotations({ title: "Stash internal API" })) {}
