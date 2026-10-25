# @stash/config-tsconfig

Shared tsconfig bases: `base`, `workers`, `web`, `extension`, `node`.

Consumers must install the type packages referenced by `compilerOptions.types` in the base they extend (e.g. `@cloudflare/workers-types` for `workers.json`, `@types/node` for `node.json`, `@types/firefox-webext-browser` for `extension.json`) — they are devDependencies here and are not installed for dependents.
