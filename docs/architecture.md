# Stash — architecture

Stash collects links and open tabs from every device into one searchable, AI-organized store.

- **Problem:** tabs pile up separately in Zen on several computers and in Safari on iPhone. Nothing syncs them, and a link you remember ("that video about economics") is hard to find again.
- **Approach:** saving takes one action and needs no organizing. AI tags and summarizes every link. Search works by meaning, and the same data is reachable from Claude through MCP.

## Product surface

| Client | What it does |
|---|---|
| Zen / Firefox extension | Hotkey saves the current tab. "Save all & close" saves a whole window or workspace. Reports open-tab snapshots and executes remote commands (e.g. close a tab). |
| iPhone | An Apple Shortcut in the Safari share sheet POSTs the link to the API. Open iPhone tabs are read on a Mac from Safari's iCloud Tabs database by `mac-agent`. |
| Web app | Search (semantic + keyword), tag and type filters, "recent" and "not yet seen" feeds, and an "Open now" view of tabs on all devices with actions (open, archive, close on device). Installable to the iPhone home screen. |
| Claude (MCP) | Remote MCP server added as a custom connector. It works in claude.ai, desktop, the iOS app and Claude Code. |
| Cron | Auto-archives Zen tabs older than N days (and closes them through the extension). Builds a weekly digest. |

## Runtime topology

```
Zen extension ─┐  API token
iOS Shortcut ──┤  API token
mac-agent ─────┤  API token          ┌─ D1 (links, tags, devices, open_tabs, commands, api_tokens, FTS5)
web (SPA) ─────┤  GitHub OAuth ──► apps/api (Worker, Effect HttpApi) ─┼─ Vectorize (embeddings)
               │                     ▲    │                          ├─ R2 (page text, transcripts)
Claude ──OAuth──► apps/mcp (Worker) ─┘    └─ Queue ─► enrichment consumer
                    Service Binding               fetch text / transcript → Claude (tags, summary, type) → embedding
```

- `apps/api` is the only owner of data. `apps/mcp` is a separate Worker. It calls `apps/api` through a Cloudflare **Service Binding** with the typed `HttpApiClient` built from `packages/contracts/api`, so it is just another client.
- `apps/web` is a static Vue SPA served via Workers Static Assets.
- Saving answers immediately and enqueues enrichment. The consumer runs Enricher → Classifier → Embedder and writes to D1, Vectorize and R2. Retries and timeouts use Effect `Schedule`.

## Stack

| Concern | Choice |
|---|---|
| Language / effects | TypeScript, **Effect v4** (`effect@4.0.6`, pinned via pnpm catalog — `effect/unstable/*` may break in minors) |
| Infra as code | **Alchemy** (`alchemy@2.0.0-beta.x` — v2 is beta; pin exact version, verify APIs against current docs) |
| Platform | Cloudflare Workers, D1, Vectorize, Queues, R2, KV, Cron Triggers, Service Bindings, Static Assets |
| AI | Classification/summaries: Claude via `@effect/ai` Anthropic provider (`claude-haiku-5-5`). Embeddings: Workers AI multilingual model (e.g. `@cf/baai/bge-m3`; content is Russian + English) |
| Web | **Vue 3** SPA, Vite, vue-router, Tailwind + shadcn-vue, state via `@effect/atom-vue`, data via `HttpApiClient` |
| Extension | **WXT** (Firefox/Zen first; keep Safari Web Extension conversion possible) |
| mac-agent | Node/Bun + Effect platform, SQLite read of `~/Library/Containers/com.apple.Safari/Data/Library/Safari/CloudTabs.db` (needs Full Disk Access), runs under launchd |
| Monorepo | **pnpm** workspaces + catalogs, **Turborepo** for task graph/caching |
| Lint / format | **oxlint** (+ community `oxlint-plugin-vue-sfc` for templates if it works), **oxfmt**, `vue-tsc` for typechecking `.vue` |
| Tests | Vitest (logic tested through Effect Layers; component tests only for UI behavior) |

## Repository layout

```
apps/                 deployables / entrypoints — thin composition roots, no business logic
  api/  mcp/  web/  extension/  mac-agent/  migrate/
packages/
  contracts/          the ONLY code shared across contexts
    domain/           Effect Schema: link, tab, device, tag, errors (depends only on effect)
    api/              HttpApi definition (groups: links, search, tabs, devices)
  backend/            links/ enrichment/ search/ tabs/ auth/ digest/ platform/
  mcp/                tools-links/ tools-tabs/ tools-digest/ platform/
  web/                links/ search/ open-tabs/ settings/ auth/ ui/ api-client/ platform/
  extension/          capture/ tab-sync/ device-commands/ platform/
  config/             tsconfig/ (per-context bases) oxlint/ (shared config + boundary rules)
```

Workspace globs are `apps/*` and `packages/*/*`. **Packages are never nested inside another package** (Turborepo rejects it, and it would break isolation).

## Context isolation rules

Each context (backend, mcp, web, extension, mac-agent) is isolated, so working in one never requires loading another into your head.

| Package lives in | May depend on |
|---|---|
| `packages/contracts/*` | `effect` only |
| `packages/backend/*`, `apps/api` | `contracts/*`, `backend/*` |
| `packages/mcp/*`, `apps/mcp` | `contracts/*`, `mcp/*` |
| `packages/web/*`, `apps/web` | `contracts/*`, `web/*` |
| `packages/extension/*`, `apps/extension` | `contracts/*`, `extension/*` |
| `packages/config/*` | — (consumed by all) |

Enforced by:
1. **Package names prefixed by context:** `@stash/contracts-domain`, `@stash/backend-links`, `@stash/web-links`, `@stash/ext-capture`, `@stash/mcp-tools-links`, `@stash/config-tsconfig`. oxlint `no-restricted-imports` bans other contexts' prefixes per directory.
2. **Explicit pnpm dependencies:** a package imports only what its `package.json` declares.
3. **Per-context tsconfig bases.** `workers` has no DOM lib and has Workers types. `web` has DOM and Vue. `extension` has DOM and WebExtension types. `node` is for mac-agent and migrate.
4. **A `CLAUDE.md` in each context** (`packages/<context>/CLAUDE.md` and the matching `apps/<x>/CLAUDE.md`) describing its patterns and allowed imports.

Cross-context features start with a change in `packages/contracts`, then each context implements its side. Duplicating small logic between contexts is acceptable and preferred over sharing it.

## Package conventions

- **kebab-case everywhere**: folders, files (including `.vue`), and `exports` subpaths. Enforced with oxlint `unicorn/filename-case`. Code identifiers stay idiomatic TS (`LinksRepo`, `<LinkCard />`).
- **The `exports` field is the public API.** List each public module explicitly, with no wildcards and no barrel `index.ts`. Anything not listed is private, so no `internal/` folders are needed. Every package sets `"sideEffects": false`.
- **Just-in-time packages.** Exports point at `.ts`/`.vue` source, the consumer bundles them, and there is no per-package build step.
- **Effect-style modules.** One concern per module. Import domain modules as namespaces: `import * as Link from "@stash/contracts-domain/link"`.
- **Organize inside a package by use case, not by file type.** Keep the package flat until it has more than about 5–7 files, then add folders per scenario (`list/`, `details/`). Name files `<concept>-<role>` (`links-list-page.vue`, `link-details-atoms.ts`, `links-repo.ts`, `save-link.ts`). Avoid `utils/`, `helpers/` and `services/` dumps.
- **`import/no-cycle` is on.**

Example:

```jsonc
// packages/web/links/package.json
{
  "name": "@stash/web-links",
  "sideEffects": false,
  "exports": {
    "./routes": "./src/routes.ts",
    "./link-card": "./src/link-card.vue",
    "./atoms": "./src/atoms.ts"
  },
  "dependencies": {
    "@stash/contracts-domain": "workspace:*",
    "@stash/web-api-client": "workspace:*",
    "@stash/web-ui": "workspace:*"
  }
}
```

## Platform packages

Only a context's `platform` package may touch runtime globals. Features depend on Effect services, and apps provide the live layers.

- `packages/web/platform` wraps Web APIs. It reuses `@effect/platform-browser` (`BrowserKeyValueStore`, `IndexedDb`, `Clipboard`, `Permissions`, `BrowserHttpClient`) and adds its own services (`share`, `network`, `visibility`, `theme`). It exports `./testing` with in-memory layers.
- `packages/extension/platform` wraps `browser.*` (`tabs`, `storage`, `alarms`, `commands`). Any browser differences, such as the future Safari port, live here.
- `packages/backend/platform` exposes Cloudflare bindings (D1, Queue, Vectorize, R2, KV, AI) as Effect services built from `env`.
- `packages/mcp/platform` exposes the Service Binding to the api as a typed client.
- An oxlint `no-restricted-globals` rule bans `window`, `document`, `localStorage`, `sessionStorage`, `indexedDB`, `navigator`, `fetch` and `chrome`/`browser` outside `platform` packages. `.vue` templates are exempt.

## Auth

- **Web and MCP** use GitHub OAuth, with one allowlisted GitHub login from env. The MCP server implements OAuth 2.1 for Claude custom connectors via `@cloudflare/workers-oauth-provider` (state in KV).
- **Extension, iOS Shortcut and mac-agent** use per-device API tokens. Only hashes are stored in D1. Tokens are revocable individually.
- Every endpoint requires auth. Saving is rate limited.

## Data model (initial)

- `links`: id, url, canonical_url, title, status (`new` / `seen` / `done` / `archived`), type (`article` / `video` / `tool` / `repo` / `other`), summary, language, source_device_id, created_at, enriched_at
- `tags`, `link_tags`
- `devices`: id, name, kind (`zen` / `ios` / `mac-agent`), tabs_taken_at (time of the current open-tabs snapshot)
- `open_tabs`: device_id, url, title, opened_at, last_seen_at (replaced per snapshot)
- `commands`: id, device_id, kind (`close-tab`, …), payload, status
- `api_tokens`: id, device_id, hash, created_at, revoked_at
- FTS5 virtual table over title / summary / text. Embeddings live in Vectorize, keyed by link id. Full text and transcripts live in R2.

## Public repository hygiene

- No secrets in git. Secrets live in Proton Pass, `.env` holds `pass://…` references and is gitignored, and `.env.example` is committed. Commands that need secrets run as `pp run --env-file .env -- <cmd>`.
- `.alchemy/` state is gitignored (or stored remotely).
- Personal values (domain, GitHub login allowlist, account ID) come from env.
- User data never enters git. Migration dumps go to a gitignored folder, and test fixtures are synthetic.
- Until a custom domain exists, deploy to `*.workers.dev`.
