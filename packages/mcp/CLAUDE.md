# CLAUDE.md — packages/mcp

Read the root [CLAUDE.md](../../CLAUDE.md) first. This file adds the rules for the mcp context.
The deployable is `apps/mcp` (see `apps/mcp/CLAUDE.md`).

## Purpose

MCP tools that expose the stash to Claude (claude.ai, desktop, iOS, Claude Code) as a remote MCP
server. The MCP server owns no data. It is just another client of `apps/api`.

| Package | Name | Contents |
|---|---|---|
| `tools-links/` | `@stash/mcp-tools-links` | Save, search, list, get, update link status |
| `tools-tabs/` | `@stash/mcp-tools-tabs` | List open tabs across devices, close a tab on a device |
| `tools-digest/` | `@stash/mcp-tools-digest` | Latest digest |
| `platform/` | `@stash/mcp-platform` | Typed api client over the Service Binding |

## May depend on

- `@stash/contracts-*`: call the API through `HttpApiClient` built from `@stash/contracts-api`, and
  use the schemas from `@stash/contracts-domain` for tool input and output.
- `@stash/mcp-*`.
- `@stash/config-*` (dev tooling).
- Third-party packages from the catalog.

Never import `@stash/backend-*`, `@stash/web-*` or `@stash/ext-*`. Above all, never reach into
backend to read data directly. oxlint enforces this.

## tsconfig base

`@stash/config-tsconfig/workers.json`: ES2024 with `@cloudflare/workers-types`, and no DOM or Node.

## Platform

`@stash/mcp-platform` is the only package that touches the Worker `env`. It turns the `API`
Service Binding into a typed `HttpApiClient` service and exports a `./testing` layer backed by an
in-memory handler. Tool packages depend on that client service only.

## Rules

- A tool is a thin adapter: decode the input, call the api client, and shape the result for the
  model. Business rules live in backend, behind the API.
- When a tool needs data the API does not expose, add the endpoint in `packages/contracts/api`
  first (contracts first), then implement it in backend.
- Keep tool names, descriptions and input schemas short and precise, because the model reads them.

## Testing

Vitest with `@effect/vitest`. Provide the tool layer plus `@stash/mcp-platform/testing` (a fake API
with synthetic data) and assert on tool results and errors. Never call a real API.

## File naming

- `tools-links/src/save-link-tool.ts`, `tools-links/src/search-links-tool.ts`
- `tools-tabs/src/close-tab-tool.ts`
- `platform/src/api-client.ts`, `platform/src/testing.ts`
- `tools-links/test/search-links-tool.test.ts`
