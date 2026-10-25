# CLAUDE.md — apps/migrate

Read the root [CLAUDE.md](../../CLAUDE.md) first.

## Purpose

A one-off CLI that imports existing links into the stash: parsers for Zen session backups
(`recovery.jsonlz4`) and a Craft export, plus a batch importer that posts them to the API. It is a
context of its own with no `packages/` counterpart.

## May depend on

- `@stash/contracts-*`: the batch import endpoint through `HttpApiClient` from
  `@stash/contracts-api`, and the schemas from `@stash/contracts-domain`.
- `@stash/config-*` (dev tooling).
- Third-party packages from the catalog (`effect`, `@effect/platform-node`, an lz4 decoder).

Never import `@stash/backend-*`, `@stash/mcp-*`, `@stash/web-*` or `@stash/ext-*`. oxlint enforces
this.

## tsconfig base

`@stash/config-tsconfig/node.json`. Add `@types/node` (`catalog:`) to devDependencies.

## Platform

There is no platform package. Use `@effect/platform-node` (`FileSystem`, `HttpClient`) behind small
services so the parsers are pure functions over bytes or strings.

## Rules

- **Real exports are personal data.** Read them from the gitignored `data/` folder or a path given
  on the command line. Never copy them into the repo, tests or logs.
- The API URL and token come from env (`pass://` reference, `pp run`).
- Imports must be idempotent. Rely on the API's canonical-URL dedupe and support `--dry-run`.

## Testing

Vitest with `@effect/vitest`. Each parser has a synthetic fixture (invented URLs and titles) that is
built in the test or committed as a small hand-written file. Test the importer with a fake API layer.

## File naming

- `src/main.ts`, `src/zen-session-parser.ts`, `src/craft-export-parser.ts`, `src/batch-importer.ts`
- `test/zen-session-parser.test.ts`, `test/fixtures/zen-session.synthetic.json`
