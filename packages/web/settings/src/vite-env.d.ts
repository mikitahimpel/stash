// `@stash/web-api-client` reads `import.meta.env.VITE_API_BASE_URL`. Its own declaration is not part
// of this program, so the part it reads is declared here too (the app gets it from `vite/client`).
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
