# @stash/config-oxlint

Shared oxlint config that enforces the rules from [docs/architecture.md](../../../docs/architecture.md).
The root `.oxlintrc.json` extends `oxlintrc.json`. oxlint finds the root config from any package,
so every package keeps `"lint": "oxlint ."`. Override globs are relative to the repo root.

## What it enforces

| Rule | Scope |
|---|---|
| `no-restricted-imports` | Context isolation by package-name prefix (table below) |
| `no-restricted-globals` | `window`, `document`, `localStorage`, `sessionStorage`, `indexedDB`, `navigator`, `fetch`, `chrome`, `browser` are banned everywhere except `packages/*/platform/**` |
| `unicorn/filename-case` | kebab-case file names, including `.vue` |
| `import/no-cycle` | No import cycles |
| `vue-sfc/*` | Template rules from `oxlint-plugin-vue-sfc` (`recommended` preset) |
| `correctness` category | Everything else oxlint rates as outright wrong |

| Files | May import `@stash/*` |
|---|---|
| `packages/contracts/**` | `contracts-*` only. Any other bare specifier except `effect`/`effect/*` is banned too. Test files may also import `vitest` and `@effect/vitest`. |
| `packages/backend/**`, `apps/api/**` | `contracts-*`, `backend-*`, `config-*` |
| `packages/mcp/**`, `apps/mcp/**` | `contracts-*`, `mcp-*`, `config-*` |
| `packages/web/**`, `apps/web/**` | `contracts-*`, `web-*`, `config-*` |
| `packages/extension/**`, `apps/extension/**` | `contracts-*`, `ext-*`, `config-*` |
| `apps/mac-agent/**`, `apps/migrate/**` | `contracts-*`, `config-*` |

Each rule is covered by `test/boundaries.test.ts`. The test writes a synthetic repo to a temp dir,
extends this config and runs the real oxlint binary on it.

## `.vue` files

oxlint lints only the `<script>` blocks of `.vue` files natively. So `no-restricted-globals` and
`no-restricted-imports` apply to the script, and templates are exempt from the globals ban by
construction. Template checks (`v-for` keys, duplicate attributes, mutating props, …) come from
[`oxlint-plugin-vue-sfc`](https://github.com/Togetic/oxlint-plugin-vue-sfc), loaded as a JS plugin
through its `recommended` preset. It works with oxlint 1.89. One known limitation: template
diagnostics point at the `<script>` block, and the real template line and column are prefixed to the
message (`[template 3:9] …`).

## Typechecking Vue packages

A package that contains `.vue` files typechecks with `vue-tsc` instead of `tsc`:

```jsonc
// packages/web/<name>/package.json
{
  "scripts": { "typecheck": "vue-tsc --noEmit -p tsconfig.json" },
  "devDependencies": {
    "@stash/config-tsconfig": "workspace:*",
    "typescript": "catalog:vue",
    "vue-tsc": "catalog:"
  }
}
```

```jsonc
// packages/web/<name>/tsconfig.json
{ "extends": "@stash/config-tsconfig/web.json", "include": ["src", "test"] }
```

`vue-tsc` 3.x drives TypeScript through its JS API. TypeScript 7 (the native port, the default
`catalog:` version) no longer ships that API, and `vue-tsc` fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED: './lib/tsc'`. Vue packages therefore pin `typescript` from the
named `vue` catalog (TypeScript 6). Non-Vue packages keep `tsc` from TypeScript 7.
