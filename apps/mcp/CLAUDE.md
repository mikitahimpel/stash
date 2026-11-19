# CLAUDE.md — apps/mcp

Read the root [CLAUDE.md](../../CLAUDE.md) and [packages/mcp/CLAUDE.md](../../packages/mcp/CLAUDE.md) first.

## Purpose

The Cloudflare Worker that serves the remote MCP server, which users add to Claude as a custom
connector. It implements OAuth 2.1 for connectors with `@cloudflare/workers-oauth-provider`
(state in KV, GitHub as the upstream identity through the Device Flow; the api decides whether
that GitHub account has a Stash account), registers the tools from `packages/mcp/*`, and calls `apps/api` through a Service Binding. It
owns no data.

## May depend on

- `@stash/contracts-*`.
- `@stash/mcp-*`.
- `@stash/config-*` (dev tooling).
- Third-party packages from the catalog.

Never import `@stash/backend-*`, `@stash/web-*` or `@stash/ext-*`. oxlint enforces this.

## tsconfig base

`@stash/config-tsconfig/workers.json`.

## Platform

`@stash/mcp-platform`. The entry builds the typed api client from the `API` Service Binding in
`env` and provides it to the tool layers. Only the entry touches `env`.

The client has no token of its own. Each sign-in mints an api token for its grant
(`ApiClient.createMcpToken` over the binding's internal endpoint) and stores it in the grant props.
Every `/mcp` request first checks that token (`ApiClient.isTokenActive`; revoked → revoke the grant
and answer 401 `invalid_token`), then provides it as `ApiClient.GrantApiToken` in the request
context, which the client's auth middleware reads.

## Rules

- Keep the entry small: OAuth provider, MCP transport, tool registration.
- The GitHub client ID (public, a plain var) and the KV namespace come from
  env. This Worker has no allowlist: it sends the GitHub account's login and numeric id to the
  api's mint endpoint, which answers with a token of that user or `LoginNotAllowed` (then no grant
  is made). The tools then act as that user alone, through that token. Never commit them. Device Flow needs no client secret, so this Worker has none.
- The GitHub access token is read once for the login and dropped. Never store or log it.
- The public origin is `MCP_ORIGIN`: the OAuth issuer and, with `/mcp`, the resource. On a stage
  with a custom domain it is the site's host, and requests arrive from the web Worker over a
  Service Binding with the public URL. The Worker then also answers on its old `workers.dev`
  origin (`MCP_LEGACY_ORIGIN`) with a provider of that origin (`OAuthProvider.make`), so
  connectors added before the move keep working. Never derive an origin from the request alone.

## Testing

Wiring tests with GitHub mocked: the OAuth flow issues and validates tokens, unauthenticated
requests are rejected, and tools are listed. Use `@stash/mcp-platform/testing` for the api. Tool
behavior is tested in `packages/mcp/*`.

## File naming

- `src/worker.ts` (entry: reads `env`, builds the live layers), `src/worker-env.ts` (bindings,
  kept in sync with `alchemy.run.ts`)
- `src/oauth-provider.ts` (`OAuthProvider` wiring), `src/oauth-handler.ts` (consent, device code
  page, poll endpoint, minting the api token), `src/authorize-pages.ts` (the server-rendered HTML), `src/stash-mark.ts` (the logo inline for
  those pages, a copy of the web kit's small mark),
  `src/device-flow-store.ts` (pending device flows in KV), `src/github-identity.ts` (GitHub Device
  Flow over `HttpClient`), `src/login-not-configured.ts` (503 on `/authorize*` while
  `GITHUB_CLIENT_ID` is unset)
- `src/mcp-server.ts` (Streamable HTTP transport from `effect/ai/McpServer`, tool registration)
- `test/oauth-handler.test.ts`, `test/cloudflare-workers-stub.ts` (Node stand-in for
  `cloudflare:workers`)
