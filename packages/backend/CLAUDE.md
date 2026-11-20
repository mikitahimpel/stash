# CLAUDE.md — packages/backend

Read the root [CLAUDE.md](../../CLAUDE.md) first. This file adds the rules for the backend context.
The deployable is `apps/api` (see `apps/api/CLAUDE.md`).

## Purpose

Backend packages hold all of the API's logic. `apps/api` is the only owner of data, and these
packages implement it.

| Package | Name | Contents |
|---|---|---|
| `links/` | `@stash/backend-links` | Save, list and filter, get, patch, delete, batch import, rate limit |
| `enrichment/` | `@stash/backend-enrichment` | Content fetcher (page text, preview image and author, YouTube oEmbed metadata and transcripts, posts on X from the public syndication endpoint with oEmbed as the fallback and never from x.com's HTML, text to R2), classifier (Claude via `@effect/ai`) with a junk filter, embedder, queue consumer, hourly requeue of pending links and metadata backfill (image and author of links enriched earlier, once per `metadataVersion`) |
| `search/` | `@stash/backend-search` | FTS5 keyword search and Vectorize semantic search behind one `SearchService` (hybrid) |
| `tabs/` | `@stash/backend-tabs` | Open-tab snapshots, devices, remote commands |
| `auth/` | `@stash/backend-auth` | Sign-in (#178): passkeys (`passkeys/`: `@simplewebauthn/server`, challenges in KV), Sign in with Google (`google/`: OIDC code flow with PKCE, ID token checked against the JWKS), linking and unlinking (`methods/`), the `signIn` handlers with their rate limit (`sign-in/`); GitHub Device Flow login and sessions (each with its `method`), API tokens (per device, or a user token such as the MCP connector's `Claude (MCP)`; only hashes stored), the internal mint endpoint, auth middleware |
| `users/` | `@stash/backend-users` | The users of a Stash (#177): `UsersRepo` (owner, members, sign-in identities), invites (create, accept once, revoke; only hashes stored), the members and invites handlers (owner only: `require-owner`), removing a member with everything they stored (`remove-member`), the daily AI quota (`ai-quota`), and `for-each-user` for cron jobs |
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
It exposes D1, Queue, Vectorize, R2, KV, Workers AI and the `LinkEvents` Durable Object as Effect services built from the Worker
`env`, and exports in-memory or fake layers as `./testing`. Feature packages depend on these
services and never on `env` or `fetch` directly. Outbound HTTP goes through the platform's
`HttpClient` layer.

## Rules

- **Everything runs as a user.** A repo method that touches user data requires
  `Security.CurrentUser` in its Effect environment and has `user_id = ?` in every statement
  (reads, writes, joins, the FTS query), so calling it without a user does not typecheck. A
  handler gets the user from `Authorization`; the queue consumer from the message's link
  (`EnrichmentRepo.ownerOf`, the one unscoped read); a cron job from `ForEachUser.forEachUser`.
  Vector queries filter on `Vectors.userIdKey`, and every upsert writes it. A link, device,
  command or token of another user is `NotFound`, like one that does not exist.
- **A layer never captures a user.** A layer that keeps its context for later calls (handlers,
  the queue consumer, the cron jobs) takes it with `ServiceContext.capture` from
  `@stash/backend-platform/service-context`, never `Effect.context`: a captured `CurrentUser`
  would override the caller's.
- **AI work is counted.** Anything that spends AI on a user's link reserves it first
  (`AiQuota.reserve`), gives it back when the run fails, and leaves the link pending when the
  day's quota is used up (`Deferred`): the link is saved either way.
- Each feature exposes Effect services and handler layers. `apps/api` composes them.
- External services (GitHub, Anthropic, Workers AI, YouTube) are always behind a service, and tests
  mock them. No test calls a real external API.
- Retries and timeouts use Effect `Schedule`, not hand-written loops.
- **Every write that changes a link tells the live stream.** After the write, publish through
  `@stash/backend-links/publish-link-event` (`updated`, `deleted`, or `changed(id)` to read the
  link first, or `saved(links)` for new ones: `storeLinks` calls it, one call per batch). It never
  fails and never waits long, so it cannot break the write. Change a link through `UpdateLink` / `DeleteLink`, not through the repo, so
  the event is not forgotten. The stream itself is `link-events.ts` (the `LinkEvents` service) and
  `link-events-object.ts` (the Durable Object's logic) in `@stash/backend-platform`.
- SQL lives next to the feature that owns the table (`links-repo.ts`). Migrations live in one place:
  `apps/api/migrations/NNNN-<name>.sql` (see `apps/api/CLAUDE.md`).

## Testing

Vitest with `@effect/vitest`. Test logic through Layers: provide the feature's layer plus the
`@stash/backend-platform/testing` layers (or a local fake) and assert on effects. Fixtures are
synthetic (`https://example.com/...`). Test handlers end to end against the contracts `HttpApi`
where it adds value.

The database of a test is `Testing.layerDatabase`: the whole schema (`./testing-schema`, a copy
of what the migrations create, checked by `apps/api/test/d1-schema.test.ts`) with three users
(`Testing.owner`, `Testing.member`, `Testing.otherMember`). Add `Testing.layerCurrentUser()` to
run as the owner, and `Testing.as(Testing.member)` on an effect to run it as someone else. A
feature that stores user data has a test with two users that shows one cannot see the other's
(`links-isolation.test.ts`, `search-isolation.test.ts`, …).

`@stash/backend-platform/testing` runs D1 on `node:sqlite`, so it needs Node types. Typecheck tests
with a separate `test/tsconfig.json` that extends `@stash/config-tsconfig/node.json` and sets
`"types": ["node", "@cloudflare/workers-types"]` (see `packages/backend/platform`).

## File naming

- `links/src/save-link.ts`, `links/src/links-repo.ts`, `links/src/links-handlers.ts`
- `enrichment/src/content-fetcher.ts`, `enrichment/src/link-classifier.ts`
- `links/src/save/x-post-url.ts` (which URLs are posts on X; the one list of hosts, used by save
  and by enrichment), `enrichment/src/parse-x-post.ts` (pure
  readers of the two sources), `enrichment/src/fetch-x-post.ts`; the test fixtures
  (`test/x-post-fixtures.ts`) have the real endpoints' shape and invented content
- `platform/src/d1-database.ts`, `platform/src/testing.ts`
- `links/test/save-link.test.ts`
