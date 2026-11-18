import { defineConfig } from "wxt";
import * as BuildOrigin from "./build-origin.ts";

// Firefox / Zen first. WXT builds Firefox as Manifest V2 by default. Keep the manifest free of
// Chrome-only keys so the Safari Web Extension conversion stays possible.
export default defineConfig({
  modules: ["@wxt-dev/module-vue"],
  // No auto-imports: every module imports what it uses, like the rest of the repo.
  imports: false,
  zip: {
    artifactTemplate: "stash-{{version}}-{{browser}}.zip",
    // A sources zip of this app alone can't rebuild it (the workspace packages are missing).
    // Add it with the workspace sources when the extension goes to addons.mozilla.org.
    zipSources: false,
  },
  // The Stash this build pairs with, from `STASH_WEB_ORIGIN` (see `build-origin.ts`).
  vite: () => ({ define: BuildOrigin.define(process.env) }),
  hooks: {
    // `imports: false` still runs unimport over every bundled file outside `node_modules`, which
    // includes the symlinked workspace packages. It would rewrite `browser.*` in
    // `@stash/ext-platform` to `import { browser } from "wxt/browser"`, which that package can't
    // resolve. Turn the rewriting off with unimport's own `autoImport` option, which its Vite
    // plugin reads but WXT's resolved type leaves out.
    "config:resolved": (wxt) => {
      Object.assign(wxt.config.imports, { autoImport: false });
    },
  },
  manifest: {
    name: "Stash",
    description: "Save links and open tabs to Stash.",
    // `tabs`, `storage` and `alarms` for the `@stash/ext-platform` services. The API origin is
    // built in by the deploy or entered on the options page, so any http(s) origin may be the API.
    permissions: ["tabs", "storage", "alarms", "https://*/*", "http://*/*"],
    // The toolbar button opens the popup (`entrypoints/popup/`, WXT adds `default_popup`). The
    // background page still shows the result of a hotkey save as a badge on it.
    browser_action: {
      default_title: "Stash",
      default_icon: { 16: "icon/16.png", 32: "icon/32.png" },
    },
    // The Well mark, drawn by `scripts/icons.ts` into `public/icon/`: the small version at 16 and
    // 32 px, the full one above.
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      96: "icon/96.png",
      128: "icon/128.png",
    },
    // The names match the `commandName` of each feature in `@stash/ext-capture`.
    commands: {
      // The browser's own command for the toolbar button: it opens the popup.
      _execute_browser_action: {
        suggested_key: { default: "Alt+Shift+A" },
        description: "Open the Stash popup",
      },
      "save-current-tab": {
        suggested_key: { default: "Alt+Shift+S" },
        description: "Save the current tab to Stash",
      },
      // Opens a popup that asks before anything is saved or closed.
      "save-all-and-close": {
        suggested_key: { default: "Alt+Shift+W" },
        description: "Save all tabs of this window or workspace to Stash and close them",
      },
    },
    browser_specific_settings: {
      gecko: {
        id: "stash@extension",
        strict_min_version: "128.0",
        // Saved links and open-tab snapshots go to the user's own Stash API.
        data_collection_permissions: { required: ["browsingActivity"] },
      },
    },
  },
});
