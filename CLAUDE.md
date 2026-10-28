# CLAUDE.md — stash (repo root)

Stash collects links and open tabs from every device into one searchable, AI-organized store.
The full design is in [docs/architecture.md](docs/architecture.md). This file holds the rules
every context shares. Each context adds its own rules in its `CLAUDE.md`. You should never need
to read another context's code or `CLAUDE.md`.

## Repo map

```
apps/                 deployables: thin composition roots, no business logic
  api/                Cloudflare Worker: Effect HttpApi server, queue consumer, cron    → apps/api/CLAUDE.md
  mcp/                Cloudflare Worker: remote MCP server, calls api via Service Binding → apps/mcp/CLAUDE.md
  web/                Vue 3 SPA on Workers Static Assets                                → apps/web/CLAUDE.md
  extension/          WXT extension for Zen / Firefox                                   → apps/extension/CLAUDE.md
  mac-agent/          Node process under launchd, reads Safari iCloud Tabs              → apps/mac-agent/CLAUDE.md
  migrate/            one-off import CLI (Zen sessions, Craft export)                   → apps/migrate/CLAUDE.md
packages/
  contracts/          the ONLY code shared across contexts (domain schemas, HttpApi)    → packages/contracts/CLAUDE.md
  backend/            api features: links, enrichment, search, tabs, auth, digest       → packages/backend/CLAUDE.md
  mcp/                MCP tools                                                         → packages/mcp/CLAUDE.md
  web/                web features and UI kit                                           → packages/web/CLAUDE.md
  extension/          extension features                                                → packages/extension/CLAUDE.md
  config/             tsconfig/ (per-context bases), oxlint/ (shared config + boundary rules)
docs/                 architecture.md, contributing.md (how to add a package)
```

Workspace globs are `apps/*` and `packages/*/*`. A package is `packages/<context>/<name>`, and
packages are never nested inside another package.

## Commands

```sh
pnpm install                                                            # Node >= 24, pnpm from packageManager
pnpm turbo run lint format:check typecheck test --filter=...[origin/main]  # check what changed (run before every commit)
pnpm turbo run lint format:check typecheck test                         # check everything (what CI runs)
pnpm --filter @stash/<package> test                                     # one package
pnpm format                                                             # oxfmt --write the whole repo
pnpm dev:api                                                            # api Worker + D1 + Queue + web Static Assets locally via Alchemy (no credentials), see docs/alchemy.md
pnpm dev:web                                                            # web SPA with hot reload (Vite on 0.0.0.0:5173)
```

- Lint is `oxlint`, format is `oxfmt` (`printWidth` 100; Markdown is not formatted), typecheck is
  `tsc` (TypeScript 7), or `vue-tsc` (TypeScript 6 from `catalog:vue`) in packages with `.vue` files.
  Tests use Vitest.
- Every package defines the same four scripts: `lint`, `format:check`, `typecheck`, `test`.
- Versions come from the pnpm catalog (`pnpm-workspace.yaml`). Use `"catalog:"` in `package.json`,
  never a literal version, and add new third-party deps to the catalog first.

## Context isolation

| Package lives in | May depend on |
|---|---|
| `packages/contracts/*` | `effect` only |
| `packages/backend/*`, `apps/api` | `contracts/*`, `backend/*` |
| `packages/mcp/*`, `apps/mcp` | `contracts/*`, `mcp/*` |
| `packages/web/*`, `apps/web` | `contracts/*`, `web/*` |
| `packages/extension/*`, `apps/extension` | `contracts/*`, `extension/*` |
| `apps/mac-agent`, `apps/migrate` | `contracts/*` |
| `packages/config/*` | — (consumed by all, as dev tooling) |

- Package names carry the context prefix: `@stash/contracts-*`, `@stash/backend-*`, `@stash/mcp-*`,
  `@stash/web-*`, `@stash/ext-*` (extension), `@stash/config-*`. oxlint's `no-restricted-imports`
  rejects other contexts' prefixes per directory.
- A package imports only what its `package.json` declares. Never reach into another package with a
  relative path (`../../other-package/src/...`). Import it by name through its `exports`.
- **Contracts first.** A feature that crosses contexts starts with a change in `packages/contracts`
  (schema or HttpApi endpoint), and then each context implements its side against the contract.
  Don't share logic across contexts in any other way. Duplicating small logic is fine and is
  preferred over sharing it.

## Conventions

- **kebab-case everywhere**: folders, files (including `.vue`), and `exports` subpaths. oxlint's
  `unicorn/filename-case` enforces this. Identifiers stay idiomatic TS (`LinksRepo`, `<LinkCard />`).
- **Explicit `exports` is the public API.** List every public module, with no wildcards. Anything
  not listed is private, so there are no `internal/` folders.
- **No barrels.** No `index.ts` that re-exports. Consumers import the module they need:
  `import * as Link from "@stash/contracts-domain/link"`.
- **`"sideEffects": false`** in every package.
- **Just-in-time packages.** `exports` point at `.ts` / `.vue` source. The consumer bundles them,
  and packages have no build step and no `dist/`.
- **Effect-style modules.** One concern per module. Import domain modules as namespaces.
- **By use case, not by file type.** Keep a package flat until it has more than about 5–7 files,
  then add one folder per scenario (`list/`, `details/`). No `utils/`, `helpers/`, `services/` or
  `components/` dumps.
- **`<concept>-<role>` file names:** `links-repo.ts`, `save-link.ts`, `links-list-page.vue`,
  `link-details-atoms.ts`, `links-repo.test.ts`.
- **`import/no-cycle`** is on.

## Platform rule

Only a context's `platform` package (`packages/<context>/platform`) may touch runtime globals:
`window`, `document`, `localStorage`, `sessionStorage`, `indexedDB`, `navigator`, `fetch`,
`chrome`, `browser`. oxlint's `no-restricted-globals` bans them everywhere else (`.vue` templates
are exempt). Feature code depends on Effect services from `platform`. Apps provide the live layers,
and tests provide in-memory layers (each platform package exports them as `./testing`). Code in
`apps/mac-agent` and `apps/migrate` has no platform package, so it keeps Node APIs at its edges
behind services.

## Effect v4

- `effect@4.0.6`, pinned exactly through the catalog together with `@effect/*` at the same version.
  Don't bump one `@effect/*` package alone.
- In v4, much of what v3 kept in `@effect/platform` lives under `effect/unstable/*` (HTTP, HttpApi,
  and similar). **`effect/unstable/*` may break in minor releases**, so the pin is exact on
  purpose. Treat any upgrade as a deliberate change and run the full check.
- v4 APIs differ from v3. Most blog posts, examples and model memory describe v3. Verify names and
  signatures against the `.d.ts` files in `node_modules/effect`, not from memory.
- Test Effect code with `@effect/vitest` (`it.effect`) and provide dependencies as Layers.

## Public repo hygiene

- The repo is public. Never commit secrets, tokens, account IDs, domains, real e-mail addresses or
  GitHub logins. Personal values come from env.
- Never hardcode, log or print secret values. That includes command output, test snapshots and
  error messages.
- User data never enters git. Test fixtures are synthetic: invented URLs (`https://example.com/...`),
  titles and devices. Migration dumps go to the gitignored `data/` folder.
- `.alchemy/`, `.wrangler/` and `.env*` are gitignored (except `.env.example`). Keep them that way.

## Secrets

- Project secrets live in the Proton Pass vault **`Stash`**. There is one item per service, and
  fields are named after the env var they feed.
- A reference is `pass://Stash/<item title>/<field>`. It must match the vault item title and field
  name **exactly, case-sensitive** (the Anthropic item is titled `Anthropic`, not `anthropic`).
- The committed root `.env.example` holds the references. Copy it to `.env`, which is gitignored
  and must stay that way. Both files hold only `pass://` references, never real values.

  | Env var | Reference | Status |
  |---|---|---|
  | `ANTHROPIC_API_KEY` | `pass://Stash/Anthropic/api_key` | item exists |
  | `CLOUDFLARE_ACCOUNT_ID` | `pass://Stash/Cloudflare/account_id` | item exists |
  | `CLOUDFLARE_API_TOKEN` | `pass://Stash/Cloudflare/api_token` | item exists |
  | `SESSION_SECRET` | `pass://Stash/app/session_secret` | planned |
  | `STASH_API_URL` | `pass://Stash/migrate/api_url` | planned |
  | `STASH_API_TOKEN` | `pass://Stash/migrate/api_token` | planned |
  | `STASH_MCP_API_TOKEN` | `pass://Stash/mcp/api_token` | planned |

- GitHub needs no vault item: the Device Flow login has no client secret, and `GITHUB_CLIENT_ID`
  is a public value from env.
- **Planned items (`app`, `migrate`, `mcp`) are not created in the vault
  yet.** Their item titles above are placeholders. They stay commented out in `.env.example`. When
  an item is created, uncomment its lines and change the reference to match the real item title
  exactly (case-sensitive), then update this table.
- To run a command that needs secrets, first set `PROTON_PASS_AGENT_REASON` to a short reason, then
  run it through `pp run`:

  ```sh
  PROTON_PASS_AGENT_REASON="classifier smoke test" pp run --env-file .env -- <cmd>
  ```

- A new secret gets an item (or a field on the service's existing item) in `Stash`, plus a line in
  `.env.example` and in this table.
