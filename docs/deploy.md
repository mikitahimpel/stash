# Deploying Stash

Stash deploys to Cloudflare `*.workers.dev` with Alchemy, from the root
[`alchemy.run.ts`](../alchemy.run.ts). [alchemy.md](alchemy.md) covers the stack itself, local
dev and the config table. This page covers a real deploy: credentials, the command, what it
creates, how to check it, and how to tear it down.

## Credentials

Only Proton Pass holds them (vault `Stash`, see root `CLAUDE.md` → Secrets). Copy
[`.env.example`](../.env.example) to `.env` (gitignored). It holds references only:

```sh
CLOUDFLARE_API_TOKEN=pass://Stash/Cloudflare/api_token
CLOUDFLARE_ACCOUNT_ID=pass://Stash/Cloudflare/account_id
ANTHROPIC_API_KEY=pass://Stash/Anthropic/api_key
```

Add the one personal value a deploy requires to the same `.env`. It is not a secret, but it is
personal, so it never goes into git:

```sh
STASH_ALLOWED_GITHUB_LOGIN=<your GitHub login>
```

Everything else is optional on deploy:

| Env var | When unset |
|---|---|
| `GITHUB_CLIENT_ID` | the login routes answer **503** `NotConfigured`: `POST /auth/device/start` and `/auth/device/poll` on the api, `/authorize*` on mcp. Everything else works. Set it once the GitHub OAuth App exists (#46) |
| `STASH_MCP_API_TOKEN` (secret) | `Mcp` gets no `API_TOKEN`, so the api answers the MCP tools with 401. OAuth still works |
| `ANTHROPIC_API_KEY` (secret) | the enrichment consumer fails each message and the queue retries it |
| `STASH_WEB_ORIGIN`, `STASH_MCP_ORIGIN` | derived: `https://stash-web.<subdomain>.workers.dev`, `https://stash-mcp.<subdomain>.workers.dev` |
| `CLOUDFLARE_WORKERS_SUBDOMAIN` | read once from the Cloudflare API with the deploy's credentials |

The account id is never written to the repo. It reaches Alchemy only through `pp run`.

## Deploy

```sh
PROTON_PASS_AGENT_REASON="stash deploy" \
  pp run --env-file .env -- pnpm exec alchemy deploy --stage prod --yes
```

- `pp run` resolves the references into the process environment. Never pass `--env-file` to
  `alchemy` itself (see [alchemy.md](alchemy.md#what-needs-real-credentials)).
- `--yes` skips the approval prompt. Run `alchemy plan --stage prod` the same way first to preview.
- Redeploying is idempotent: an unchanged stack plans `no changes`.
- The deploy prints the three URLs (`url`, `mcpUrl`, `webUrl`).

## What gets created

All names are generic. Workers are named `stash-<role>` on stage `prod` (`stash-<role>-<stage>`
on any other stage). The other resources get Alchemy's derived names
(`stash-<LogicalId>-<stage>-<hash>`).

| Logical id | Cloudflare resource | Notes |
|---|---|---|
| `Api` | Worker `stash-api` | `fetch`, `queue` and `scheduled` handlers. Cron Triggers `0 3 * * *` and `0 6 * * 1` (UTC) |
| `Mcp` | Worker `stash-mcp` | Service Binding `API` → `stash-api` |
| `Web` | Worker `stash-web` | assets-only (Workers Static Assets), SPA fallback. Built with `VITE_API_BASE_URL` = the api's URL |
| `Database` | D1 database | `apps/api/migrations` applied on every deploy, tracked in `__alchemy_migrations` |
| `EnrichmentQueue` | Queue | producer on `Api` |
| `EnrichmentConsumer` | Queue consumer | delivers to `Api`'s `queue()` (batch 10, max wait 1 s) |
| `Vectors` | Vectorize index | 1024 dimensions, cosine (`@cf/baai/bge-m3`). Deploy only |
| `Blobs` | R2 bucket | page text and transcripts |
| `Kv` | KV namespace | api save rate limits |
| `OAuthState` | KV namespace | mcp OAuth clients, grants, tokens |
| — | Workers AI binding `AI` on `Api` | deploy only |

`Api` also gets the plain vars `ALLOWED_GITHUB_LOGIN`, `WEB_ORIGIN`, `GITHUB_CLIENT_ID` (when set)
and `SMOKE_ROUTES=off`, and the secret `ANTHROPIC_API_KEY`. `Mcp` gets `ALLOWED_GITHUB_LOGIN`,
`MCP_ORIGIN`, `GITHUB_CLIENT_ID` (when set) and the secret `API_TOKEN` (when set).

The account's `workers.dev` subdomain itself is read, never changed.

## State

State stays on disk in `.alchemy/state/stash/<stage>/` of the checkout that deployed (gitignored).
It holds the account id and **the Worker secrets in plaintext** (the Anthropic key is in
`Api.json`), so never commit, paste or share it. Deploy, plan and destroy from the checkout that
holds the state. A checkout without it plans every resource as new and collides with the
existing ones. Copy the folder to move it, or adopt a private remote state store
(`Cloudflare.state()`, see [alchemy.md](alchemy.md)) in a later change.

There is no CI deploy job: with local state, a runner would not see the existing resources.

## Check a deploy

Replace the hosts with the URLs the deploy printed.

```sh
curl -sf https://stash-api.<subdomain>.workers.dev/health                                   # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' https://stash-api.<subdomain>.workers.dev/links      # 401
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://stash-web.<subdomain>.workers.dev/  # 200 text/html
curl -s https://stash-mcp.<subdomain>.workers.dev/.well-known/oauth-authorization-server     # 200, issuer = mcp origin
curl -s -X POST https://stash-api.<subdomain>.workers.dev/auth/device/start                  # 503 until GITHUB_CLIENT_ID is set
```

The applied D1 migrations (the database id is `attr.databaseId` in
`.alchemy/state/stash/prod/Database.json`):

```sh
PROTON_PASS_AGENT_REASON="stash d1 check" pp run --env-file .env -- sh -c 'curl -s \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "content-type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/<database id>/query" \
  -d "{\"sql\":\"SELECT name, applied_at FROM __alchemy_migrations ORDER BY id\"}"'
```

## GitHub OAuth App (#46)

Both logins use the GitHub **Device Flow**, so GitHub never redirects back to Stash and neither the
api nor mcp has a callback route. One OAuth App serves both (the same public `GITHUB_CLIENT_ID` is
bound on `Api` and `Mcp`). Create it at GitHub → Settings → Developer settings → OAuth Apps:

| Field | Value |
|---|---|
| Homepage URL | `https://stash-web.<subdomain>.workers.dev` |
| Authorization callback URL (web login) | `https://stash-web.<subdomain>.workers.dev/` |
| Authorization callback URL (MCP connector, if you make a second app) | `https://stash-mcp.<subdomain>.workers.dev/` |
| Enable Device Flow | **checked** |

GitHub's form requires a callback URL even though the Device Flow never uses one, so it points at
the origin each login starts from. There is no client secret: don't generate one.

Then redeploy with the client id:

```sh
GITHUB_CLIENT_ID=<client id> PROTON_PASS_AGENT_REASON="stash deploy" \
  pp run --env-file .env -- pnpm exec alchemy deploy --stage prod --yes
```

(or add `GITHUB_CLIENT_ID=<client id>` to `.env`). `POST /auth/device/start` then returns a
`userCode`, and the MCP `/authorize` page shows one. [mcp-connector.md](mcp-connector.md) covers
adding the connector to Claude.

## Tear down

```sh
PROTON_PASS_AGENT_REASON="stash destroy" \
  pp run --env-file .env -- pnpm exec alchemy destroy --stage prod
```

It deletes exactly the resources in the stage's state (the table above), including the D1 data,
the R2 bucket and the Vectorize index. Nothing else on the account is touched.
