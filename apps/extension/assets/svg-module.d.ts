// Vite gives the URL of an imported SVG (the logo in the popup and the options page).
declare module "*.svg" {
  const url: string;
  export default url;
}
