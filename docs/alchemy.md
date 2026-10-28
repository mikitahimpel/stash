# Alchemy (infrastructure as code)

Stash declares its Cloudflare infrastructure with [Alchemy](https://alchemy.run) v2, in the root
[`alchemy.run.ts`](../alchemy.run.ts). This page records what the spike (issue #4) proved, how to
run it, and what to watch for.

## Version

| Package | Version | Where |
|---|---|---|
| `alchemy` | `2.0.0-beta.84` | `pnpm-workspace.yaml` catalog, root `devDependencies` |
| `@alchemy.run/cloudflare` | `2.0.0-beta.84` | same |
| `workerd` (transitive, via `@alchemy.run/cloudflare-runtime`) | `1.20261012.1` | lockfile |

- v2 is **beta**, and breaking changes land between betas. The pin is exact on purpose. Bump
  `alchemy` and every `@alchemy.run/*` package together, never one alone (the Cloudflare package
  has an exact peer dependency on `alchemy`).
- v2 is a different library from v1. It is built on Effect v4 (`effect@^4.0.5` peer), so most blog
  posts and model memory (v1, `await alchemy("app")`) don't apply. Verify APIs against the
  `.d.ts` / `src` files in `node_modules/alchemy` and `node_modules/@alchemy.run/cloudflare`, and
  against <https://alchemy.run/llms.txt>.
- `workerd` has a postinstall script, so `pnpm-workspace.yaml` allows it under `allowBuilds`.
  pnpm reports one unmet peer (`capnp-es` wants TypeScript 5 or 6, and we use 7). It only affects
  types and is harmless.

## What `alchemy.run.ts` declares

| Logical id | Resource | Binding on `Api` |
|---|---|---|
| `Database` | `Cloudflare.D1.Database`, `migrations: ./apps/api/migrations` | `DB` (`D1Database`) |
| `EnrichmentQueue` | `Cloudflare.Queues.Queue` | `ENRICHMENT_QUEUE` (`Queue`, producer) |
| `Kv` | `Cloudflare.KV.Namespace` (save rate limits) | `KV` (`KVNamespace`) |
| `Api` | `Cloudflare.Worker`, `main: ./apps/api/src/worker.ts` | vars `ALLOWED_GITHUB_LOGIN`, `WEB_ORIGIN`, `GITHUB_OAUTH_CLIENT_ID`, `SMOKE_ROUTES`; secret `GITHUB_OAUTH_CLIENT_SECRET` |
| `EnrichmentConsumer` | `Cloudflare.Queues.Consumer` | delivers the queue to `Api`'s `queue()` handler |
| `OAuthState` | `Cloudflare.KV.Namespace` | `OAUTH_KV` on `Mcp` (`KVNamespace`): OAuth clients, grants, tokens |
| `Mcp` | `Cloudflare.Worker`, `main: ./apps/mcp/src/worker.ts` | `API` (Service Binding to `Api`), `OAUTH_KV`, vars `MCP_ORIGIN`, `GITHUB_CLIENT_ID`, `ALLOWED_GITHUB_LOGIN`, secret `API_TOKEN` |
| `Web` | `Cloudflare.Website.StaticSite`, `cwd: ./apps/web`, `outdir: dist` | — (assets-only Worker serving the SPA) |

- `Api` is an **async Worker**: `main` points at a plain module that exports `fetch`, `queue` and
  `scheduled`,
  and bindings are declared with the `env` prop. Worker code never imports Alchemy, so the IaC
  beta stays out of the runtime bundle and `apps/api` keeps a normal Workers entry. Its binding
  types live in `apps/api/src/worker-env.ts` and must match `env` in `alchemy.run.ts`.
  (`Cloudflare.InferEnv<typeof Worker>` could derive them, but that would make `apps/api` import
  the root stack file. That crosses a package boundary, so we keep the interface by hand.)
- **Nothing personal is hardcoded.** Physical names are derived from the stack (`stash`), the stage
  and the logical id (for example `stash-enrichmentqueue-<stage>-<hash>`). The Cloudflare account
  comes from `CLOUDFLARE_ACCOUNT_ID` or an Alchemy profile, and only `deploy` reads it.
- State uses `State.localState()`, which writes it to `.alchemy/` on disk. `.alchemy` is
  gitignored (the pattern has no trailing slash, so `git check-ignore .alchemy` succeeds even
  before the folder exists). A remote state store (`Cloudflare.state()`) is a decision for the
  deploy issue.

Config read by the stack (optional under `alchemy dev`; the OAuth client secret and the MCP API
token are secret):

| Env var | Default | Meaning |
|---|---|---|
| `STASH_API_PORT` | `8787` | local dev port of `Api` (`strictPort`: it fails instead of picking another) |
| `STASH_API_HOST` | `0.0.0.0` | local dev bind host |
| `STASH_WEB_ORIGIN` | `http://localhost:5173` under `alchemy dev`, **required** for deploy | `WEB_ORIGIN` on `Api`: the only CORS origin |
| `STASH_ALLOWED_GITHUB_LOGIN` | `dev_only` under `alchemy dev` (not a valid GitHub login), **required** for deploy | `ALLOWED_GITHUB_LOGIN` on `Api` and `Mcp` |
| `GITHUB_OAUTH_CLIENT_ID` | `dev_only` under `alchemy dev`, **required** for deploy | `GITHUB_OAUTH_CLIENT_ID` on `Api` |
| `GITHUB_OAUTH_CLIENT_SECRET` (secret) | `dev_only` under `alchemy dev`, **required** for deploy | `GITHUB_OAUTH_CLIENT_SECRET` on `Api`, read with `Config.Redacted` so it is bound as `secret_text` |
| `GITHUB_CLIENT_ID` | `dev_only` under `alchemy dev`, **required** for deploy | `GITHUB_CLIENT_ID` on `Mcp`: the public client ID for the GitHub Device Flow (a plain var, no secret) |
| `STASH_MCP_PORT` | `8790` | local dev port of `Mcp` (`strictPort`) |
| `STASH_MCP_ORIGIN` | `http://localhost:$STASH_MCP_PORT` under `alchemy dev`, **required** for deploy | `MCP_ORIGIN` on `Mcp`: OAuth issuer and resource origin (resource is `<origin>/mcp`) |
| `STASH_MCP_API_TOKEN` (secret) | `dev_only` under `alchemy dev`, **required** for deploy | `API_TOKEN` on `Mcp`: the bearer it sends to `Api`, read with `Config.Redacted` |
| `STASH_WEB_PORT` | `8791` | local dev port of `Web` (not strict: it picks the next free port when taken) |
| `STASH_WEB_HOST` | `0.0.0.0` | local dev bind host of `Web` |
| `ALCHEMY_STAGE` | `dev_$USER` (dev), `live_$USER` (deploy) | stage, which also sets physical names and the state folder |

## Local development (no credentials)

```sh
pnpm dev:api            # = alchemy dev
curl -sf http://localhost:8787/health   # {"status":"ok"}
curl -sf http://localhost:8790/.well-known/oauth-authorization-server   # Mcp: OAuth metadata
curl -sf http://localhost:8791/links    # the SPA's index.html (SPA fallback)
```

- `Web` runs `pnpm run build` in `apps/web` (memoized on the app, the `packages/web/*` sources and
  the lockfile) and serves `apps/web/dist` from a local assets-only Worker. Unknown paths fall
  back to `index.html` (`notFoundHandling: "single-page-application"`), so client routes load.
- For hot reload while working on the UI, run `pnpm dev:web` instead (Vite on
  `http://0.0.0.0:5173`). It doesn't need `alchemy dev`.

`alchemy dev` runs the stack file under `node --watch`. Every resource above has a local provider,
so the plan shows `create (local)` for all of them and makes **no Cloudflare API calls**:

- `Api` runs in **workerd** (not Miniflare, though it is Miniflare-compatible) at
  `http://0.0.0.0:8787`, and hot reloads when `apps/api/src/**` changes.
- D1 is a local SQLite simulator under `.alchemy/local/d1/`.
- KV is a local simulator.
- The queue is a local broker with batching, retry and dead-letter semantics. The consumer
  resource wires it to `Api`'s `queue()` handler in the same workerd.
- Worker logs go to the terminal and to `.alchemy/log/<stage>/Api/*.log`.
- Stop it with Ctrl-C (SIGINT), which also stops workerd and Alchemy's sidecar process. Killing
  only the `pnpm` wrapper with SIGTERM (for example `timeout`) leaves `alchemy`, its sidecar and
  workerd running. Send SIGINT to the process group instead.

### Smoke test

`apps/api/test/local-dev-smoke.test.ts` (run by `pnpm --filter @stash/api test`, so also by
turbo and CI) spawns `alchemy dev --stage smoke` from the repo root with every `CLOUDFLARE_*`
variable removed and `STASH_API_PORT=8788` (or `STASH_SMOKE_PORT`). It then checks:

1. `GET /health` returns 200 `{"status":"ok"}` without credentials.
2. The `StashApi`: `GET /links` without a credential answers 401. `POST /_smoke/api-token` seeds
   a device and the SHA-256 hash of a synthetic token, and that bearer token then lists itself on
   `GET /tokens`, saves a link twice on `POST /links` (the second save returns the same link),
   finds it on `GET /links`, and gets 501 `NotImplemented` from `GET /devices`. A CORS preflight from
   `STASH_WEB_ORIGIN` (set by the test) is allowed with credentials, and other origins are not.
3. `POST /_smoke/d1` inserts a row into D1 and reads it back.
   `GET /_smoke/schema` lists the tables, which shows the migrations in `apps/api/migrations` were
   applied (Alchemy splits each file into statements and keeps trigger bodies whole).
4. `POST /_smoke/queue` sends one `EnrichmentMessage`. The (no-op) consumer logs
   `enrichment: received <linkId>`, and the test waits for that line in the `alchemy dev` output.

The `/_smoke/*` routes are dev scaffolding (`apps/api/src/smoke-routes.ts`). They answer only
when the `SMOKE_ROUTES` binding is `"on"`, which `alchemy.run.ts` sets only when `ALCHEMY_DEV` is
true. `/_smoke/d1` creates its own table with `CREATE TABLE IF NOT EXISTS`. Remove the routes once
feature endpoints cover the schema, token issuing and the queue.

The Worker builds the `HttpRouter.toWebHandler` app once, at module scope, from the `env` export
of `cloudflare:workers`, on Effect's sync scheduler (global scope allows no timers). The same
wiring runs on Node in `apps/api/test/worker.test.ts` against the in-memory platform layers.

A cold run takes about 5 s on a laptop.

## What needs real credentials

- `alchemy deploy`, `plan`, `destroy`, `logs` and `drift` against a live stage. These are out of
  scope here and blocked on the `cloudflare` vault item (see root `CLAUDE.md` → Secrets).
- Any resource **without** a local provider, even under `alchemy dev`. Alchemy then deploys it to
  the real cloud into the dev stage and needs credentials. As of beta.84 that includes
  **Vectorize** (its local client calls the Cloudflare HTTP API) and Workers AI inference. A
  resource wrapped in `.pipe(Alchemy.remote())` also counts. Keep such resources behind backend
  services so tests use fakes and `pnpm dev:api` stays credential-free as long as possible.

When the `cloudflare` item exists, the plan is (unverified):

```sh
PROTON_PASS_AGENT_REASON="stash deploy" pp run --env-file .env -- pnpm exec alchemy deploy --stage prod
```

`pp run` puts the resolved values into the process environment, and Alchemy prefers the shell
environment over the `.env` file it auto-loads. Do **not** pass `--env-file .env` to `alchemy`
itself: with that flag the file wins over the shell, and Alchemy would read the literal `pass://`
references.

## Gotchas

- Alchemy auto-loads `.env` from the working directory. It only ever holds `pass://` references,
  which are harmless while nothing reads them. See the deploy note above.
- `alchemy dev` defaults to stage `dev_$USER`, and state is per checkout (`.alchemy/` lives in the
  worktree). Worktrees only collide on local ports (`STASH_API_PORT`) and on cloud resources once
  any exist. Then use a stage per worktree (`--stage dev_<worktree>`).
- Switching a resource between local and live (dev → deploy, or adding `remote()`) is planned as a
  **replacement**. Local data never becomes cloud data.
- Alchemy reads its own config through `effect/Config` (`Config.Port`, `Config.String`,
  `Alchemy.ALCHEMY_DEV`) at construction time, not through `process.env`.
- Both `alchemy` and `@alchemy.run/cloudflare` declare `@effect/platform-node` and
  `@effect/platform-bun` as optional peers. The CLI runs on Node here, so the root installs
  `@effect/platform-node` (catalog `4.0.6`).
- `alchemy.run.ts` is typechecked by the root `typecheck:root` task (`tsconfig.json` at the root,
  Node base). `apps/api`'s `test` task lists `alchemy.run.ts` as a turbo input, so editing the stack
  re-runs the smoke test.

## Adding more resources later

These are the APIs as documented for beta.84. **None of them were exercised in this spike.**
Check them again when you add them.

| Need | Declare | Bind on the async `Api` Worker | Local in dev? |
|---|---|---|---|
| R2 bucket (page text, transcripts) | `Cloudflare.R2.Bucket("PageText")` | `env: { PAGE_TEXT: bucket }` → `R2Bucket` | yes, simulator |
| Vectorize index | `Cloudflare.Vectorize.Index("Embeddings", { dimensions: 1024, metric: "cosine" })` (bge-m3 is 1024-d) | documented only for Effect-native Workers (`Cloudflare.Vectorize.SearchIndex(index)`). `InferEnv` has no Vectorize case in beta.84, so async `env` support is unconfirmed | **no**, needs credentials |
| Workers AI | — | `env: { AI: Cloudflare.Workers.AI() }` → `Ai` | **no**, needs credentials |
| Cron triggers | `crons: ["0 3 * * *"]` prop on `Cloudflare.Worker` | export `scheduled()` from `worker.ts` | yes, fires on schedule; trigger manually via `/cdn-cgi/handler/scheduled` |
| Static Assets (web SPA) | `Cloudflare.Website.Vite("Web", { … })`, or a Worker with `assets: "./dist"` (or `{ directory, config }`) | `env.ASSETS` when the Worker has assets | yes, runs Vite's own dev server |
| Secrets (Anthropic key, session secret) | `effect/Config` / `Redacted` values on `env`, or Secrets Store | `env: { ANTHROPIC_API_KEY: Config.Redacted("ANTHROPIC_API_KEY") }` → `string` | yes, local store |

Docs: [Cloudflare local dev](https://alchemy.run/cloudflare/local-development),
[Workers / async Workers](https://alchemy.run/cloudflare/compute/workers),
[D1](https://alchemy.run/cloudflare/data/d1), [Queues](https://alchemy.run/cloudflare/messaging/queues),
[R2](https://alchemy.run/cloudflare/data/r2), [KV](https://alchemy.run/cloudflare/data/kv),
[Vectorize](https://alchemy.run/cloudflare/ai/vectorize),
[Workers AI](https://alchemy.run/cloudflare/ai/workers-ai),
[Cron](https://alchemy.run/cloudflare/messaging/cron),
[Static sites](https://alchemy.run/cloudflare/frontend/static-site),
[Secrets & env](https://alchemy.run/cloudflare/security/secrets-env),
[State store](https://alchemy.run/state-store).
