// Vite gives the URL of an imported SVG (the logo in the popup and the options page).
declare module "*.svg" {
  const url: string;
  export default url;
}

// What `wxt.config.ts` bakes into the bundle (`build-origin.ts`).
interface ImportMetaEnv {
  readonly STASH_WEB_ORIGIN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
