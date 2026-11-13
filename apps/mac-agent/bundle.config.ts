// `pnpm --filter @stash/mac-agent bundle`: the agent as one self-contained ES module,
// `dist/stash-mac-agent.mjs`, with every dependency inlined and only Node built-ins imported. The
// web app serves it at `/downloads/stash-mac-agent.mjs` for `install-standalone.sh`, so a Mac
// needs only Node >= 24, not a checkout or `pnpm install` (see README.md).
import { defineConfig } from "vite";

export default defineConfig({
  logLevel: "warn",
  build: {
    ssr: "src/main.ts",
    target: "node24",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: { entryFileNames: "stash-mac-agent.mjs", codeSplitting: false },
    },
  },
  ssr: { target: "node", noExternal: true },
});
