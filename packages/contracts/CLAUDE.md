# CLAUDE.md — packages/contracts

Read the root [CLAUDE.md](../../CLAUDE.md) first. This file adds the rules for the contracts context.

## Purpose

Contracts hold the only code shared across contexts: the domain model and the HTTP API that every
client codes against. Each context (backend, mcp, web, extension, mac-agent, migrate) depends on
contracts. Contracts depend on no context.

| Package | Name | Contents |
|---|---|---|
| `domain/` | `@stash/contracts-domain` | Effect Schema for link (with the optional `post` of a link to a post on X), stream events (`./link-event`: link changes and `tabs.updated`, a device's new tab set), tag, device, tab (with the optional window, last active time and icon of a tab, and `SavedTab`), command, token, digest, user and account (`./user`: role, daily AI quota, today's AI use), invite (`./invite`), sign-in methods (`./sign-in`: passkeys, linked Google and GitHub accounts, WebAuthn ceremony JSON), and tagged errors |
| `api/` | `@stash/contracts-api` | `HttpApi` definition with groups links, search, tabs, devices, tokens, auth, digest, pairings, connect, members (`./members`: the caller's account, and for the owner the list and removing a member), invites (`./invites`: owner-only create / list / revoke, and the open `check`), events (`GET /events`, the live stream: a WebSocket of `LinkEvent` JSON texts from `@stash/contracts-domain/link-event`, 426 for a plain request), signIn (`./sign-in`: passkeys, Google, linking); plus `InternalApi` (`./internal-api`) for Worker-to-Worker calls |

## May depend on

- `effect` (including `effect/http-api` and `effect/http` for `api/`; in `effect@4.0.6` HttpApi lives
  there, not under `effect/unstable/*`).
- Other `@stash/contracts-*` packages. `api` depends on `domain`, never the other way.
- In tests only: `vitest`, `@effect/vitest`.
- `@stash/config-*` as devDependencies (tsconfig base).

Nothing else. oxlint rejects any other bare import under `packages/contracts/**`, including
`@effect/*`, Node built-ins and every other `@stash/*` context.

## tsconfig base

`@stash/config-tsconfig/base.json`. It has no DOM, Workers or Node types, because contracts must
run in every runtime.

## Platform

None. Contracts are pure: schemas, types and the API description, with no I/O, no runtime globals
and no implementations. Servers and clients live in their own contexts.

## Rules

- Contracts change first. A cross-context feature starts here, and then each context implements its
  side.
- Changes are breaking for every consumer. Prefer additive changes (new optional field, new
  endpoint). When you must rename or remove something, update consumers in the same PR or split
  the change.
- Model errors as tagged error schemas in `domain` and attach them to endpoints in `api`.
- Keep validation in schemas (brands, filters) so every client gets the same rules.

## HTTP mapping (`api/`)

- Domain errors carry no HTTP status. `api/src/error-statuses.ts` (private) annotates them
  (`ValidationError` 400, `Unauthorized` 401, `Forbidden` 403, `NotFound` 404, `Conflict` 409,
  `RateLimited` 429, `DeviceFlowExpired` 410, `DeviceFlowDenied` and `LoginNotAllowed` 403), and groups attach those annotated schemas to endpoints.
- Every endpoint is guarded by `Authorization` from `./security` (bearer API token, then session
  cookie), except `auth.deviceStart` and `auth.devicePoll` (GitHub Device Flow login),
  `pairings.claim` (the extension claims its token with a one-time code its user approved) and
  `invites.check` (whether an invite link still works, asked before signing in), and the open
  half of `signIn` (`./sign-in`, #178: `providers`, the passkey sign-in and sign-up ceremonies,
  Google's start and callback). The rest of `signIn` (Settings → Security) also answers
  `Forbidden` to an API token: only a web session may change how its user signs in. `Authorization`
  provides `CurrentPrincipal` (a device or the user) and `CurrentUser` (whose data: id and role).
  Owner-only endpoints declare `Forbidden`.
- `InternalApi` (`internal-api.ts`) is a separate `HttpApi`, not part of `StashApi`, with no auth
  middleware: `apps/api` serves it only on a named entrypoint that only a Service Binding reaches.
  It has `internal.createMcpToken` (`POST /internal/mcp-tokens`, by GitHub account) and
  `internal.createMcpTokenForSession` (`POST /internal/mcp-tokens/session`, by a web session
  cookie), which `apps/mcp` calls.

## Testing

Vitest with `@effect/vitest`. Test schemas by decoding and encoding synthetic values: valid input
round-trips, and invalid input fails with the expected issue. Test the API definition for shape
(groups, paths, success and error schemas), not for behavior.

## File naming

- `domain/src/link.ts`, `domain/src/device.ts`, `domain/src/link-errors.ts`
- `api/src/links-group.ts`, `api/src/search-group.ts`, `api/src/stash-api.ts`
- `domain/test/link.test.ts`
- Exports: `"./link": "./src/link.ts"`, consumed as `import * as Link from "@stash/contracts-domain/link"`.
