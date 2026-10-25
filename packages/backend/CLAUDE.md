# CLAUDE.md — packages/backend

Read the root [CLAUDE.md](../../CLAUDE.md) first. This file adds the rules for the backend context.
The deployable is `apps/api` (see `apps/api/CLAUDE.md`).

## Purpose

Backend packages hold all of the API's logic. `apps/api` is the only owner of data, and these
packages implement it.

| Package | Name | Contents |
|---|---|---|
| `links/` | `@stash/backend-links` | Save, list and filter, get, patch, delete, batch import, rate limit |
| `enrichment/` | `@stash/backend-enrichment` | Content fetcher (page text, YouTube transcripts to R2), classifier (Claude via `@effect/ai`), embedder, queue consumer |
| `search/` | `@stash/backend-search` | FTS5 keyword search and Vectorize semantic search behind one `SearchService` (hybrid) |
| `tabs/` | `@stash/backend-tabs` | Open-tab snapshots, devices, remote commands |
| `auth/` | `@stash/backend-auth` | GitHub OAuth sessions, per-device API tokens (only hashes stored), auth middleware |
| `digest/` | `@stash/backend-digest` | Cron jobs: auto-archive old Zen tabs, weekly digest |
| `platform/` | `@stash/backend-platform` | Cloudflare bindings as Effect services |

## May depend on

- `@stash/contracts-*`: implement the `HttpApi` groups from `@stash/contracts-api` and use the
  schemas from `@stash/contracts-domain`.
- `@stash/backend-*`.
- `@stash/config-*` (dev tooling).
- Third-party packages from the catalog: `effect`, `@effect/ai`, `@effect/ai-anthropic` and so on.

Never import `@stash/mcp-*`, `@stash/web-*` or `@stash/ext-*`. oxlint enforces this.

## tsconfig base

`@stash/config-tsconfig/workers.json`: ES2024 with `@cloudflare/workers-types`, and no DOM or Node.
Add `@cloudflare/workers-types` (`catalog:`) to the package's devDependencies.

## Platform

`@stash/backend-platform` is the only package that touches `env`, `fetch` or Cloudflare bindings.
It exposes D1, Queue, Vectorize, R2, KV and Workers AI as Effect services built from the Worker
`env`, and exports in-memory or fake layers as `./testing`. Feature packages depend on these
services and never on `env` or `fetch` directly. Outbound HTTP goes through the platform's
`HttpClient` layer.

## Rules

- Each feature exposes Effect services and handler layers. `apps/api` composes them.
- External services (GitHub, Anthropic, Workers AI, YouTube) are always behind a service, and tests
  mock them. No test calls a real external API.
- Retries and timeouts use Effect `Schedule`, not hand-written loops.
- SQL lives next to the feature that owns the table (`links-repo.ts`). Migrations live in one place:
  `apps/api/migrations/NNNN-<name>.sql` (see `apps/api/CLAUDE.md`).

## Testing

Vitest with `@effect/vitest`. Test logic through Layers: provide the feature's layer plus the
`@stash/backend-platform/testing` layers (or a local fake) and assert on effects. Fixtures are
synthetic (`https://example.com/...`). Test handlers end to end against the contracts `HttpApi`
where it adds value.

## File naming

- `links/src/save-link.ts`, `links/src/links-repo.ts`, `links/src/links-handlers.ts`
- `enrichment/src/content-fetcher.ts`, `enrichment/src/link-classifier.ts`
- `platform/src/d1-database.ts`, `platform/src/testing.ts`
- `links/test/save-link.test.ts`
