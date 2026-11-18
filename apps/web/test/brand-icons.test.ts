import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as Path from "node:path";
import { describe, expect, it } from "vitest";

// The files `scripts/brand-icons.ts` writes, as the page and the manifest name them.
const appDir = Path.resolve(import.meta.dirname, "..");
const publicFile = (path: string) => Path.join(appDir, "public", path);

/** Width, height and whether the PNG has an alpha channel (colour type 4 or 6), from its IHDR. */
const png = (path: string) => {
  const bytes = readFileSync(publicFile(path));
  expect(bytes.subarray(1, 4).toString("latin1"), path).toBe("PNG");
  const colorType = bytes.readUInt8(25);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    alpha: colorType === 4 || colorType === 6,
  };
};

describe("brand icons", () => {
  it("has the favicon as the kit's small mark, with 32 and 16 px fallbacks", () => {
    const small = readFileSync(
      createRequire(import.meta.url).resolve("@stash/web-ui/stash-mark-sm.svg"),
      "utf8",
    );
    expect(readFileSync(publicFile("/favicon.svg"), "utf8")).toBe(small);
    expect(png("/icons/favicon-32.png")).toEqual({ width: 32, height: 32, alpha: true });
    expect(png("/icons/favicon-16.png")).toEqual({ width: 16, height: 16, alpha: true });
  });

  it("has opaque home screen icons in the sizes the manifest states", () => {
    expect(png("/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180, alpha: false });
    const manifest = JSON.parse(readFileSync(publicFile("/manifest.webmanifest"), "utf8")) as {
      readonly theme_color: string;
      readonly icons: ReadonlyArray<{ readonly src: string; readonly sizes: string }>;
    };
    expect(manifest.theme_color).toBe("#0c0c0d");
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512", "512x512"]);
    for (const icon of manifest.icons) {
      const size = Number(icon.sizes.split("x")[0]);
      expect(png(icon.src), icon.src).toEqual({ width: size, height: size, alpha: false });
    }
  });

  it("links only icons that exist from index.html", () => {
    const html = readFileSync(Path.join(appDir, "index.html"), "utf8");
    const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"/g)].map(
      (match) => match[1] ?? "",
    );
    expect(hrefs).toEqual([
      "/favicon.svg",
      "/icons/favicon-32.png",
      "/icons/favicon-16.png",
      "/icons/apple-touch-icon.png",
    ]);
    for (const href of hrefs) expect(existsSync(publicFile(href)), href).toBe(true);
    expect(html).toContain('<meta name="theme-color" content="#0c0c0d" />');
  });
});
