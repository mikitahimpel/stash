import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite";

// The PWA manifest and icons live in `public/`, which Vite copies to the output as is and doesn't
// list. This fails the build when the manifest is missing and prints its path when it is there.
const checkManifest = (): Plugin => {
  let outDir = "dist";
  return {
    name: "stash:check-manifest",
    apply: "build",
    configResolved: (config) => {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const file = join(outDir, "manifest.webmanifest");
      if (!existsSync(file)) this.error(`PWA manifest missing from the build: ${file}`);
      this.environment.logger.info(`PWA manifest: ${relative(process.cwd(), file)}`);
    },
  };
};

// Vite rejects requests whose Host header isn't on its allowlist, which blocks opening the dev
// server by hostname from another machine. `STASH_DEV_ALLOWED_HOSTS` (comma-separated) adds hosts
// to it. Unset or empty keeps Vite's default.
const allowedHosts = (process.env["STASH_DEV_ALLOWED_HOSTS"] ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter((host) => host.length > 0);
const hostsConfig = allowedHosts.length > 0 ? { allowedHosts } : {};

// `pnpm dev` binds 0.0.0.0 through `--host` in package.json, so the dev server opens from other
// machines.
export default defineConfig({
  plugins: [vue(), tailwindcss(), checkManifest()],
  server: { port: 5173, ...hostsConfig },
  preview: hostsConfig,
});
