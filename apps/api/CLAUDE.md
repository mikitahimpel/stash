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
Vectorize, R2, KV, Workers AI, the `LinkEvents` Durable Object) and provides them to the feature layers. The entry may touch `env`
and the `fetch` / `queue` / `scheduled` handler arguments. Nothing else here should.

## Rules

- Keep the entry small: build layers, compose handlers, export the `fetch`, `queue` and `scheduled`
  handlers.
- Bindings and personal values (allowlisted GitHub login, domain) come from env and Alchemy config,
  never from source. Secrets use `pass://` references in `.env` (see root `CLAUDE.md`).
- `apps/mcp` reaches this Worker through a Service Binding, so every endpoint it uses must be in
  the contracts `HttpApi`.
- `worker.ts` exports two ways in. The default `fetch` (the `*.workers.dev` route and the web
  Worker's `/api/*` proxy, which is how the custom domain reaches it) serves `StashApi` only. The named entrypoint `InternalApi` serves
  `StashApi` plus the contracts `InternalApi` (`api-layer.ts` → `internalLayer`), and only
  `apps/mcp`'s `API` binding targets it. Never add internal routes to the default `fetch`.

## Testing

Wiring tests only: the composed layer builds, routes respond, and auth is required. Use the
`@stash/backend-platform/testing` layers. Feature behavior is tested in `packages/backend/*`.

## File naming

- `src/worker.ts` (entry), `src/api-layer.ts`, `src/queue-handler.ts`, `src/scheduled-handler.ts`
- `src/handlers.ts`: one handler layer per `StashApi` group, each from its feature package (listed
  in `dependencies`).
- `src/queue-handler.ts`: the enrichment consumer. A message names only a link; the consumer
  finds the link's user and runs the pipeline as them.
- `src/scheduled-handler.ts`: the cron expressions and the job each one runs, once per user, as
  that user (`ForEachUser`).  A user whose run fails does not stop the others. Keep them in sync
  with `crons` on the `Api` Worker in the root `alchemy.run.ts`.
- `src/smoke-routes.ts`: dev-only `/_smoke/*` routes (on only under `alchemy dev`), with the
  synthetic screenshot data in `src/smoke-seed.ts`.
- `src/login-not-configured.ts`: 503 on the device flow routes while `GITHUB_CLIENT_ID` is unset.
- `src/events-upgrade.ts`: the WebSocket upgrade of `GET /events`. Effect's router cannot return
  a Workers WebSocket response, so the Worker asks the router first without the upgrade headers
  (the same `Authorization` middleware answers 401, or 426 when the caller may connect) and then
  hands the request to the user's `LinkEvents` Durable Object (one per user: the Worker asks the
  router for `/members/me` with the caller's credentials and names the object by that id). A stream opened with the session
  cookie must name `WEB_ORIGIN` as its `Origin` (403 otherwise; a dev page on another host
  name then falls back to asking), and the object refuses streams past `maxStreams`. `worker.ts` exports that class
  (`LinkEvents`, a thin shell over `LinkEventsObject` from `@stash/backend-platform`); the
  binding `LINK_EVENTS` and its class migration are declared in `alchemy.run.ts`.
- `src/worker-env.ts`: binding types. Keep it in sync with the `Api` Worker's `env` in the root
  `alchemy.run.ts` (see [docs/alchemy.md](../../docs/alchemy.md)).
- `migrations/NNNN-<name>.sql`: the D1 schema, one forward-only file per change (never edit an
  applied file). A new table with user data has `user_id TEXT NOT NULL REFERENCES users (id) ON
  DELETE CASCADE` and its indexes start with it; no LIKE or GLOB pattern over 50 bytes; after a
  change, paste the schema the test prints into `packages/backend/platform/src/testing-schema.ts`. Alchemy applies them in numeric order on every `alchemy dev` / deploy.
  `test/d1-schema.test.ts` applies them to a fresh SQLite and checks tables, constraints and FTS5.
- `test/worker.test.ts`
- `test/user-isolation.test.ts`: every endpoint of `StashApi` (read from the definition), called
  as one user against another's data on the composed layer: 404 (or 403 for owner-only ones),
  nothing of the other user in the answer, nothing of theirs changed. **A new endpoint needs a
  case in its `cases` table**, or the test fails.
- `test/local-dev-smoke.test.ts` boots `alchemy dev` and checks health, D1, queue delivery and the live stream over the Durable Object. It is
  the only test that runs the real Worker in workerd.
