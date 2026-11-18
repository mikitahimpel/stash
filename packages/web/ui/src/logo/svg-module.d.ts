// Vite gives the URL of an imported SVG. `apps/web` gets the same type from `vite/client`.
declare module "*.svg" {
  const url: string;
  export default url;
}
