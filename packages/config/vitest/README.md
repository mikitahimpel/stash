# @stash/config-vitest

Shared Vitest settings. Every package's `vitest.config.ts` merges `vitest-base.ts`:

```ts
import * as VitestBase from "@stash/config-vitest/vitest-base";
import { defineProject, mergeConfig } from "vitest/config";

export default mergeConfig(VitestBase.base, defineProject({ test: { name: "<package>" } }));
```

It sets `maxWorkers: 2` (see "Resource limits" in the root `CLAUDE.md`). A package config must not
set `maxWorkers` itself. `test/max-workers.test.ts` resolves every package's config and fails if
`maxWorkers` is not 2.
