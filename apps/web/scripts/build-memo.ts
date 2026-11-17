// The inputs of the `Web` build, as the `memo.include` globs of the `StaticSite` in
// `alchemy.run.ts`. Alchemy hashes the matching files and rebuilds when the hash changes. Paths are
// relative to `apps/web`.
//
// Alchemy filters by `.gitignore` only inside the build's own directory. A pattern that starts
// with `../` is globbed as written, and the glob follows symlinks. So `../extension/**` also walks
// `node_modules` and, through pnpm's links, the packages behind it: about 200,000 files, which a
// deploy never finished hashing (#145). Every `../` pattern here must therefore name real inputs
// and stay out of `node_modules` and build output (`test/build-memo.test.ts` checks it).

/** The app itself (gitignored files stay excluded) and the web packages it bundles. */
const app: ReadonlyArray<string> = ["**/*", "../../packages/web/*/src/**"];

/**
 * What `build:deploy` reads on top of that for the files under `/downloads/`: the extension
 * (`package:xpi` runs `wxt zip`) and the Mac agent (`bundle`, plus its installer) with the
 * workspace packages they bundle.
 */
const downloads: ReadonlyArray<string> = [
  "../extension/entrypoints/**",
  "../extension/public/**",
  "../extension/assets/**",
  "../extension/scripts/**",
  "../extension/*.{ts,json}",
  "../../packages/extension/*/src/**",
  "../mac-agent/src/**",
  "../mac-agent/launchd/**",
  "../mac-agent/*.{ts,json,sh}",
  "../../packages/contracts/*/src/**",
];

/**
 * The globs for `alchemy dev` (`dev`, which runs the plain `build`) or for a deploy (which runs
 * `build:deploy`). `alchemy dev` builds no downloads, and hashing their inputs would slow every
 * start.
 */
export const include = (dev: boolean): Array<string> => (dev ? [...app] : [...app, ...downloads]);
