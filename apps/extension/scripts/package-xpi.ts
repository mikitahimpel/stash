// `pnpm --filter @stash/extension package:xpi -- <out.xpi>`: builds the Firefox / Zen extension and
// writes it as an installable `.xpi` to `<out.xpi>`. The deploy runs it for the web app, which
// serves the file at `/downloads/stash-extension.xpi` (see `alchemy.run.ts`).
//
// Release Firefox and Zen install only add-ons signed by Mozilla (`xpinstall.signatures.required`
// is ignored outside Developer Edition, Nightly and ESR). With AMO API credentials in env
// (`WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`, the JWT issuer and secret from
// https://addons.mozilla.org/developers/addon/api/key/, as `pass://` references resolved by
// `pp run`), the build is signed as an unlisted (self-distributed) add-on with `web-ext sign`. AMO
// signs a version once, so a signed build gets a dated version, and the signed file is cached in
// `.output/signed/` under a hash of the unsigned build: an unchanged extension is never signed twice.
// Without credentials the `.xpi` is unsigned, which only Developer Edition / Nightly accept, and the
// script says so. It never prints the credentials.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as Fs from "node:fs";
import * as Path from "node:path";
import * as XpiVersion from "./xpi-version.ts";

const appDir = Path.resolve(import.meta.dirname, "..");
const outputDir = Path.join(appDir, ".output");
const buildDir = Path.join(outputDir, "firefox-mv2");
const signedDir = Path.join(outputDir, "signed");

const out = process.argv.slice(2).find((arg) => arg !== "--");
if (out === undefined) {
  console.error("usage: package-xpi <out.xpi>");
  process.exit(2);
}
const target = Path.resolve(process.cwd(), out);

const run = (command: string, args: ReadonlyArray<string>) => {
  const result = spawnSync(command, args, { cwd: appDir, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`package-xpi: ${command} ${args[0] ?? ""} failed`);
    process.exit(result.status ?? 1);
  }
};

const bin = (name: string) => Path.join(appDir, "node_modules", ".bin", name);

/** Every file of the build with its contents, in a stable order. */
const hashDir = (dir: string): string => {
  const hash = createHash("sha256");
  const walk = (current: string) => {
    for (const entry of Fs.readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = Path.join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else hash.update(Path.relative(dir, path)).update("\0").update(Fs.readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex").slice(0, 16);
};

const copyTo = (source: string) => {
  Fs.mkdirSync(Path.dirname(target), { recursive: true });
  Fs.copyFileSync(source, target);
};

// `wxt zip` builds `.output/firefox-mv2/` and zips it. The zip of an unsigned build is the `.xpi`.
run(bin("wxt"), ["zip", "--browser", "firefox"]);
const key = hashDir(buildDir);
const cached = Path.join(signedDir, `${key}.xpi`);
const signing =
  (process.env["WEB_EXT_API_KEY"] ?? "") !== "" && (process.env["WEB_EXT_API_SECRET"] ?? "") !== "";

if (Fs.existsSync(cached)) {
  copyTo(cached);
  console.log(`package-xpi: signed (cached ${key}) -> ${target}`);
} else if (signing) {
  // Sign a copy whose manifest carries a fresh version, then keep the result under the build hash.
  const staging = Path.join(outputDir, "sign-staging");
  const artifacts = Path.join(outputDir, "sign-artifacts");
  Fs.rmSync(staging, { recursive: true, force: true });
  Fs.rmSync(artifacts, { recursive: true, force: true });
  Fs.cpSync(buildDir, staging, { recursive: true });
  const manifest = Path.join(staging, "manifest.json");
  const version = XpiVersion.signedVersion(new Date());
  Fs.writeFileSync(manifest, XpiVersion.withVersion(Fs.readFileSync(manifest, "utf8"), version));
  // web-ext reads the credentials from WEB_EXT_API_KEY / WEB_EXT_API_SECRET itself.
  run(bin("web-ext"), [
    "sign",
    "--channel",
    "unlisted",
    "--source-dir",
    staging,
    "--artifacts-dir",
    artifacts,
  ]);
  const signed = Fs.readdirSync(artifacts).find((name) => name.endsWith(".xpi"));
  if (signed === undefined) {
    console.error("package-xpi: web-ext sign produced no .xpi");
    process.exit(1);
  }
  Fs.mkdirSync(signedDir, { recursive: true });
  Fs.copyFileSync(Path.join(artifacts, signed), cached);
  copyTo(cached);
  console.log(`package-xpi: signed ${version} -> ${target}`);
} else {
  const zip = Fs.readdirSync(outputDir).find((name) => /^stash-.*-firefox\.zip$/.test(name));
  if (zip === undefined) {
    console.error("package-xpi: wxt zip produced no zip");
    process.exit(1);
  }
  copyTo(Path.join(outputDir, zip));
  console.warn(
    "package-xpi: UNSIGNED (no WEB_EXT_API_KEY / WEB_EXT_API_SECRET). Release Firefox and Zen " +
      `refuse it; see apps/extension/README.md. -> ${target}`,
  );
}
