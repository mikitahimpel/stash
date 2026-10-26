# CLAUDE.md — apps/api

Read the root [CLAUDE.md](../../CLAUDE.md) and [packages/backend/CLAUDE.md](../../packages/backend/CLAUDE.md) first.

## Purpose

The Cloudflare Worker that owns all data. It is the composition root of the backend context: it
serves the `HttpApi` from `@stash/contracts-api`, applies the auth middleware and CORS, consumes the
enrichment queue, and runs cron triggers. It holds no business logic. Logic lives in
`packages/backend/*`.

## May depend on

- `@stash/contracts-*`.
- `@stash/backend-*`.
- `@stash/config-*` (dev tooling).
- Third-party packages from the catalog.

Never import `@stash/mcp-*`, `@stash/web-*` or `@stash/ext-*`. oxlint enforces this.

## tsconfig base

`@stash/config-tsconfig/workers.json`.

## Platform

`@stash/backend-platform`. The Worker entry builds the live layers from `env` (D1, Queue,
Vectorize, R2, KV, Workers AI) and provides them to the feature layers. The entry may touch `env`
and the `fetch` / `queue` / `scheduled` handler arguments. Nothing else here should.

## Rules

- Keep the entry small: build layers, compose handlers, export the `fetch`, `queue` and `scheduled`
  handlers.
- Bindings and personal values (allowlisted GitHub login, domain) come from env and Alchemy config,
  never from source. Secrets use `pass://` references in `.env` (see root `CLAUDE.md`).
- `apps/mcp` reaches this Worker through a Service Binding, so every endpoint it uses must be in
  the contracts `HttpApi`.

## Testing

Wiring tests only: the composed layer builds, routes respond, and auth is required. Use the
`@stash/backend-platform/testing` layers. Feature behavior is tested in `packages/backend/*`.

## File naming

- `src/worker.ts` (entry), `src/api-layer.ts`, `src/queue-handler.ts`, `src/scheduled-handler.ts`
- `src/handlers.ts`: one handler layer per `StashApi` group, each from its feature package (listed
  in `dependencies`).
- `src/scheduled-handler.ts`: the cron expressions and the job each one runs. Keep them in sync
  with `crons` on the `Api` Worker in the root `alchemy.run.ts`.
- `src/smoke-routes.ts`: dev-only `/_smoke/*` routes (on only under `alchemy dev`).
- `src/worker-env.ts`: binding types. Keep it in sync with the `Api` Worker's `env` in the root
  `alchemy.run.ts` (see [docs/alchemy.md](../../docs/alchemy.md)).
- `migrations/NNNN-<name>.sql`: the D1 schema, one forward-only file per change (never edit an
  applied file). Alchemy applies them in numeric order on every `alchemy dev` / deploy.
  `test/d1-schema.test.ts` applies them to a fresh SQLite and checks tables, constraints and FTS5.
- `test/worker.test.ts`
- `test/local-dev-smoke.test.ts` boots `alchemy dev` and checks health, D1 and queue delivery. It is
  the only test that runs the real Worker in workerd.
