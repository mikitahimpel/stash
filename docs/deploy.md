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

Nothing else is needed for stage `prod`. Everything else is optional there:

| Env var | When unset |
|---|---|
| `STASH_ALLOWED_GITHUB_LOGIN` | stage `prod` uses the committed owner login (`PROD_ALLOWED_GITHUB_LOGIN` in [`alchemy.run.ts`](../alchemy.run.ts), public and committed at the owner's request). Any other deployed stage fails without it |
| `GITHUB_CLIENT_ID` | stage `prod` uses the committed id of the project's OAuth App (see [below](#github-oauth-app)). Any other stage: the login routes answer **503** `NotConfigured` (`POST /auth/device/start` and `/auth/device/poll` on the api, `/authorize*` on mcp), and everything else works |
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

Workers are named `stash-<role>` on stage `prod` (`stash-<role>-<stage>` on any other stage). On
other stages the storage gets Alchemy's derived names (`stash-<LogicalId>-<stage>-<hash>`). Stage
`prod` pins them in `PROD_NAMES` (see [State](#state)).

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

`Api` also gets the plain vars `ALLOWED_GITHUB_LOGIN`, `WEB_ORIGIN`, `GITHUB_CLIENT_ID` (always on `prod`)
and `SMOKE_ROUTES=off`, and the secret `ANTHROPIC_API_KEY`. `Mcp` gets `ALLOWED_GITHUB_LOGIN`,
`MCP_ORIGIN`, `GITHUB_CLIENT_ID` (always on `prod`) and the secret `API_TOKEN` (when set).

The account's `workers.dev` subdomain itself is read, never changed.

## State

Stage `prod` keeps its Alchemy state in the D1 database **`stash-alchemy-state`** of the same
account, never on disk. [`alchemy-d1-state.ts`](../alchemy-d1-state.ts) is a small state store
over the Cloudflare REST API, using the deploy's own `CLOUDFLARE_API_TOKEN`. The first deploy
creates the database. It is not part of the stack, so `alchemy destroy` keeps it. Any checkout
can deploy, plan or destroy `prod`, and removing a worktree loses nothing. Other stages keep
local state in `.alchemy/state/stash/<stage>/` (gitignored).

The rows hold the account id and **the Worker secrets in plaintext** (the Anthropic key is in the
`Api` row), the same as the local store, so never paste or share them. Anyone holding the deploy
token can already read them, so storing them in D1 does not widen access.

Alchemy's own `Cloudflare.state()` store is not used. It keeps its token and encryption key in
the account's Secrets Store, which the deploy token cannot access (`/secrets_store/stores`
answers `Authentication error`). The account's shared `alchemy-state-store` also runs store
version 7, while the pinned beta.84 expects version 5, and `--yes` would redeploy it. To switch
later, give the token **Secrets Store: Edit** and use `Cloudflare.state({ name: "stash" })` (its
own Worker `alchemy-state-store-stash`).

The physical names of the prod storage are pinned in `PROD_NAMES` to the resources the #46 deploy
created, so a deploy adopts them by name even with empty state and never creates a second set.
Every provider involved adopts by name (D1, Queue and KV by name or title, R2 and Vectorize with a
`get`). Workers have fixed names and carry Alchemy's ownership tags.

There is no CI deploy job yet: it would need the Cloudflare and Anthropic secrets in CI.

## Check a deploy

Replace the hosts with the URLs the deploy printed.

```sh
curl -sf https://stash-api.<subdomain>.workers.dev/health                                   # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' https://stash-api.<subdomain>.workers.dev/links      # 401
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://stash-web.<subdomain>.workers.dev/  # 200 text/html
curl -s https://stash-mcp.<subdomain>.workers.dev/.well-known/oauth-authorization-server     # 200, issuer = mcp origin
curl -s -X POST https://stash-api.<subdomain>.workers.dev/auth/device/start                  # 200 {"flowId",…,"userCode":"XXXX-XXXX","verificationUri":"https://github.com/login/device",…}
```

A `userCode` from `POST /auth/device/start` proves GitHub accepts the client id. On a stage
without `GITHUB_CLIENT_ID` the same call answers 503 `NotConfigured`. The MCP side is checked in
[GitHub OAuth App](#github-oauth-app).

The applied D1 migrations (the database id is `attr.databaseId` in
`.alchemy/state/stash/prod/Database.json`):

```sh
PROTON_PASS_AGENT_REASON="stash d1 check" pp run --env-file .env -- sh -c 'curl -s \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "content-type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/<database id>/query" \
  -d "{\"sql\":\"SELECT name, applied_at FROM __alchemy_migrations ORDER BY id\"}"'
```

## GitHub OAuth App

Both logins use the GitHub **Device Flow**, so GitHub never redirects back to Stash and neither the
api nor mcp has a callback route. One OAuth App serves both: the same public `GITHUB_CLIENT_ID` is
bound on `Api` and `Mcp`. The app exists, with **Enable Device Flow** checked and no client secret
(don't generate one). Its client id is public, so it is committed in
[`alchemy.run.ts`](../alchemy.run.ts) as the default for stage `prod` (`PROD_GITHUB_CLIENT_ID`).
A `GITHUB_CLIENT_ID` in env overrides it, on any stage.

To make a new app (another account, or a fork), create it at GitHub → Settings → Developer
settings → OAuth Apps:

| Field | Value |
|---|---|
| Homepage URL | `https://stash-web.<subdomain>.workers.dev` |
| Authorization callback URL | `https://stash-web.<subdomain>.workers.dev/` |
| Enable Device Flow | **checked** |

GitHub's form requires a callback URL even though the Device Flow never uses one. Then change
`PROD_GITHUB_CLIENT_ID`, or deploy with `GITHUB_CLIENT_ID=<client id>` in `.env`.

### Check the MCP login

The MCP `/authorize` page needs a registered client. Register a throwaway one (Dynamic Client
Registration), open the consent page, approve it, and read the user code from the device page.
`M` is the mcp URL the deploy printed:

```sh
M=https://stash-mcp.<subdomain>.workers.dev; J=$(mktemp); R=http://localhost:9999/callback
CID=$(curl -s -X POST $M/register -H 'content-type: application/json' \
  -d "{\"client_name\":\"deploy-check\",\"redirect_uris\":[\"$R\"],\"token_endpoint_auth_method\":\"none\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).client_id')
CH=$(node -pe 'require("crypto").createHash("sha256").update("x".repeat(43)).digest("base64url")')
Q="response_type=code&client_id=$CID&redirect_uri=$R&code_challenge=$CH&code_challenge_method=S256&state=check"
H=$(curl -s -c $J -b $J "$M/authorize?$Q" | grep -o 'name="handle" value="[^"]*"' | cut -d'"' -f4)
curl -s -c $J -b $J -L "$M/authorize?$Q" --data-urlencode "handle=$H" -d decision=approve \
  | grep -o -E '[A-Z0-9]{4}-[A-Z0-9]{4}|https://github.com/login/device' | sort -u   # user code + GitHub link
```

Don't pass `-X POST`: curl would keep POST on the 303 to `/authorize/device` and get a 404.

### Sign in end to end (manual)

A full sign-in needs a person to enter the code on github.com, signed in as
`STASH_ALLOWED_GITHUB_LOGIN`. Any other account is refused after GitHub approves.

1. **Web.** Open `https://stash-web.<subdomain>.workers.dev`. The login gate shows a code and a
   link to `https://github.com/login/device`. Open it, enter the code, authorize the app. The
   page signs in by itself within a few seconds (it polls `/auth/device/poll`) and shows your links.
2. **MCP.** Add `https://stash-mcp.<subdomain>.workers.dev/mcp` as a custom connector in Claude
   ([mcp-connector.md](mcp-connector.md)). Claude opens `/authorize`: press **Continue with
   GitHub**, enter the code shown on github.com, keep the tab open, and it returns you to Claude.
3. **MCP tools.** The tools call the api with `STASH_MCP_API_TOKEN`. Until it is set they get 401.
   Once signed in on the web, mint a token with `POST /tokens`, store it in Proton Pass (vault
   `Stash`, see root `CLAUDE.md` → Secrets), add its reference to `.env` and redeploy.

## Last deployed

Commit `c59da7a` on 2026-10-29, stage `prod`, from the #126 branch (`main` at `3ebaa69` plus the
D1 state and `PROD_NAMES` change):

```text
$ PROTON_PASS_AGENT_REASON="…" pp run --env-file .env -- pnpm exec alchemy deploy --stage prod --yes
Plan: 2 to update                     # Web/Build, Web (first deploy of this change: 5 created, 6 adopted)
Done: 2 succeeded (7.9s)              # exit 0
$ … alchemy plan --stage prod         # with no .alchemy/state on disk
Plan: no changes
$ curl -s https://stash-api.<subdomain>.workers.dev/health
{"status":"ok"}                       # 200
$ curl … https://stash-api.<subdomain>.workers.dev/links
401
$ curl … https://stash-web.<subdomain>.workers.dev/
200 text/html
$ curl … https://stash-mcp.<subdomain>.workers.dev/.well-known/oauth-authorization-server
200, issuer https://stash-mcp.<subdomain>.workers.dev
$ curl -X POST https://stash-api.<subdomain>.workers.dev/auth/device/start
200 {"flowId":"…","userCode":"A333-8D28","verificationUri":"https://github.com/login/device",…}
$ curl -s https://stash-web.<subdomain>.workers.dev/ | grep -o 'src="/assets/[^"]*"'
src="/assets/index-DJfKt7Od.js"
$ VITE_API_BASE_URL=https://stash-api.<subdomain>.workers.dev pnpm --filter @stash/web build
src="/assets/index-DJfKt7Od.js"       # same entry hash
```

The local build needs the same `VITE_API_BASE_URL` the deploy sets: the api URL is inlined into
the bundle, so a build without it has another entry hash.

## Tear down

```sh
PROTON_PASS_AGENT_REASON="stash destroy" \
  pp run --env-file .env -- pnpm exec alchemy destroy --stage prod
```

It deletes exactly the resources in the stage's state (the table above), including the D1 data,
the R2 bucket and the Vectorize index. Nothing else on the account is touched.
