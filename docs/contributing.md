# Contributing

Read [architecture.md](architecture.md) and the root [CLAUDE.md](../CLAUDE.md) first. Each context
has its own `CLAUDE.md` in `packages/<context>/` and `apps/<x>/`.

Before every commit, run:

```sh
pnpm install
pnpm turbo run lint format:check typecheck test --filter=...[origin/main]
```

## Creating a new package

A package lives at `packages/<context>/<name>` (the workspace glob is `packages/*/*`). Never nest it
inside another package. Its name is `@stash/<prefix>-<name>`, where the prefix is `contracts`,
`backend`, `mcp`, `web`, `ext` (extension) or `config`. Folder and file names are kebab-case.

### 1. `package.json`

```jsonc
// packages/backend/links/package.json
{
  "name": "@stash/backend-links",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    // one entry per public module, pointing at source; no wildcards, no index.ts barrel
    "./save-link": "./src/save-link.ts",
    "./links-repo": "./src/links-repo.ts"
  },
  "scripts": {
    "lint": "oxlint .",
    "format:check": "oxfmt --check .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@stash/contracts-domain": "workspace:*",
    "effect": "catalog:"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "catalog:",
    "@effect/vitest": "catalog:",
    "@stash/config-tsconfig": "workspace:*",
    "oxfmt": "catalog:",
    "oxlint": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- Only depend on packages your context may use (see the table in `CLAUDE.md`). oxlint enforces it.
- Third-party versions always come from the catalog (`"catalog:"`). Add a new dependency to
  `pnpm-workspace.yaml` first.
- There is no `build` script. Consumers bundle the source (just-in-time packages).

### 2. `tsconfig.json`

Extend the base for your context and add the type package it needs to devDependencies:

| Context | Base | Types package |
|---|---|---|
| contracts | `@stash/config-tsconfig/base.json` | — |
| backend, mcp, `apps/api`, `apps/mcp` | `@stash/config-tsconfig/workers.json` | `@cloudflare/workers-types` |
| web, `apps/web` | `@stash/config-tsconfig/web.json` | — |
| extension, `apps/extension` | `@stash/config-tsconfig/extension.json` | `@types/firefox-webext-browser` |
| `apps/mac-agent`, `apps/migrate` | `@stash/config-tsconfig/node.json` | `@types/node` |

```jsonc
// packages/backend/links/tsconfig.json
{
  "extends": "@stash/config-tsconfig/workers.json",
  "include": ["src", "test", "vitest.config.ts"]
}
```

A package with `.vue` files typechecks with `vue-tsc --noEmit -p tsconfig.json` and uses
`"typescript": "catalog:vue"`. See [packages/config/oxlint/README.md](../packages/config/oxlint/README.md).

### 3. `vitest.config.ts`

The root `vitest.config.ts` picks up every `packages/*/*/vitest.config.ts` as a project.

```ts
// packages/backend/links/vitest.config.ts
import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "backend-links",
    include: ["test/**/*.test.ts"],
  },
});
```

### 4. Source and tests

```
packages/backend/links/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    save-link.ts
    links-repo.ts
  test/
    save-link.test.ts
```

- Name files `<concept>-<role>`. Keep the package flat until it has more than about 5–7 files, then
  add one folder per use case.
- Tests use synthetic data only.

Then run `pnpm install` so the workspace links the package, and run the checks above.
