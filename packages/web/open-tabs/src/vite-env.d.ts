// The part of Vite's `import.meta.env` that `@stash/web-api-client` reads, so its sources
// typecheck here. `apps/web` gets the full type from `vite/client`, which merges with this one.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
