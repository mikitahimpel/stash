# CLAUDE.md — apps/mcp

Read the root [CLAUDE.md](../../CLAUDE.md) and [packages/mcp/CLAUDE.md](../../packages/mcp/CLAUDE.md) first.

## Purpose

The Cloudflare Worker that serves the remote MCP server, which users add to Claude as a custom
connector. It implements OAuth 2.1 for connectors with `@cloudflare/workers-oauth-provider`
(state in KV, GitHub as the upstream identity, one allowlisted login from env), registers the tools
from `packages/mcp/*`, and calls `apps/api` through a Service Binding. It owns no data.

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

## Rules

- Keep the entry small: OAuth provider, MCP transport, tool registration.
- The GitHub client ID and secret, the allowlisted login and the KV namespace come from env. Never
  commit them.

## Testing

Wiring tests with GitHub mocked: the OAuth flow issues and validates tokens, unauthenticated
requests are rejected, and tools are listed. Use `@stash/mcp-platform/testing` for the api. Tool
behavior is tested in `packages/mcp/*`.

## File naming

- `src/worker.ts` (entry: reads `env`, builds the live layers), `src/worker-env.ts` (bindings,
  kept in sync with `alchemy.run.ts`)
- `src/oauth-provider.ts` (`OAuthProvider` wiring), `src/oauth-handler.ts` (consent page, GitHub
  redirect and callback, allowlist), `src/github-identity.ts` (GitHub code exchange over
  `HttpClient`)
- `src/mcp-server.ts` (Streamable HTTP transport from `effect/ai/McpServer`, tool registration)
- `test/oauth-handler.test.ts`, `test/cloudflare-workers-stub.ts` (Node stand-in for
  `cloudflare:workers`)
