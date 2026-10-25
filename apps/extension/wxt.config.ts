import { defineConfig } from "wxt";

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
    // entered on the options page, so any http(s) origin may be the API.
    permissions: ["tabs", "storage", "alarms", "https://*/*", "http://*/*"],
    // The toolbar button saves the current tab and shows the result as a badge. No popup, so a
    // click reaches the background page.
    browser_action: { default_title: "Save to Stash" },
    // The names match the `commandName` of each feature in `@stash/ext-capture`.
    commands: {
      "save-current-tab": {
        suggested_key: { default: "Alt+Shift+S" },
        description: "Save the current tab to Stash",
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
