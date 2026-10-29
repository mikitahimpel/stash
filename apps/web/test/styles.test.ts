import * as Fs from "node:fs";
import * as Path from "node:path";
import { describe, expect, it } from "vitest";

const appDir = Path.resolve(import.meta.dirname, "..");
const styles = Fs.readFileSync(Path.join(appDir, "src/styles.css"), "utf8");
const manifest = JSON.parse(Fs.readFileSync(Path.join(appDir, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

// Tailwind generates only the classes it finds in its sources. A feature package missing from
// `@source` renders with its own classes silently dropped (no gaps, no colors).
const hasTemplates = (dir: string): boolean =>
  Fs.readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory() ? hasTemplates(Path.join(dir, entry.name)) : entry.name.endsWith(".vue"),
  );

const features = Object.keys(manifest.dependencies)
  .filter((name) => name.startsWith("@stash/web-") && name !== "@stash/web-ui")
  .filter((name) => hasTemplates(Path.join(appDir, "node_modules", name, "src")));

describe("styles.css", () => {
  it("finds feature packages with templates", () => {
    expect(features).toContain("@stash/web-settings");
  });

  it.each(features)("scans %s for Tailwind classes", (name) => {
    expect(styles).toContain(`@source "../node_modules/${name}/src";`);
  });
});
