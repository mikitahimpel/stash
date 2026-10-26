// `@stash/web-api-client` reads `import.meta.env.VITE_API_BASE_URL`. Its source is typechecked
// here too, so this package declares the same part of Vite's `import.meta.env`.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
