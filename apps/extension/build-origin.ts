// The Stash this build belongs to. The `.xpi` the web app serves is built by that web app's
// deploy, which passes its own origin in `STASH_WEB_ORIGIN` (`alchemy.run.ts`). `wxt.config.ts`
// bakes it into the bundle with `define`, so the options page can pair without asking for an
// address. Nothing domain-specific is committed: a build without the variable (`pnpm build`, the
// dev server) has no built-in origin, and the options page asks for the address instead.

/** The env var the deploy sets for the extension build. */
export const envName = "STASH_WEB_ORIGIN";

/** An http(s) origin from `value` (`https://stash.example.com/` → `https://stash.example.com`), or `""`. */
export const normalize = (value: string | undefined): string => {
  const trimmed = (value ?? "").trim();
  if (!/^https?:\/\//i.test(trimmed)) return "";
  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
};

/** Vite's `define` for the build: the bundle reads the origin as `import.meta.env.STASH_WEB_ORIGIN`. */
export const define = (env: Readonly<Record<string, string | undefined>>) => ({
  [`import.meta.env.${envName}`]: JSON.stringify(normalize(env[envName])),
});

/** The origin baked into this bundle, or `""` when the build had none. */
export const builtIn = (): string => normalize(import.meta.env.STASH_WEB_ORIGIN);
