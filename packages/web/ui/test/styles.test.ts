// @vitest-environment node
/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { describe, expect, it } from "vitest";

const stylesPath = fileURLToPath(new URL("../src/styles.css", import.meta.url));

const build = async (candidates: Array<string>) => {
  const compiler = await compile(await readFile(stylesPath, "utf8"), {
    base: fileURLToPath(new URL("../src", import.meta.url)),
    onDependency: () => {},
  });
  return { compiler, css: compiler.build(candidates) };
};

describe("Tailwind preset", () => {
  it("maps the theme tokens to utilities", async () => {
    const { css } = await build(["bg-background", "text-muted-foreground", "rounded-lg"]);

    expect(css).toMatch(/\.bg-background\s*{\s*background-color: var\(--background\)/);
    expect(css).toMatch(/\.text-muted-foreground\s*{\s*color: var\(--muted-foreground\)/);
    expect(css).toMatch(/\.rounded-lg\s*{\s*border-radius: var\(--radius\)/);
  });

  it("switches dark mode with the .dark class, not the OS setting", async () => {
    const { css } = await build(["dark:bg-input/30"]);

    expect(css).toContain(":where(.dark, .dark *)");
    expect(css).not.toContain("prefers-color-scheme");
    expect(css).toMatch(/\.dark\s*{[^}]*--background:/);
  });

  it("defines the tactile surfaces as utilities with hover and active states", async () => {
    const { css } = await build([
      "tactile-raised",
      "tactile-primary",
      "tactile-sunken",
      "tactile-key",
    ]);

    expect(css).toMatch(/\.tactile-raised\s*{[^}]*linear-gradient\(180deg, var\(--raised-from\)/);
    expect(css).toMatch(
      /\.tactile-raised\s*{[\s\S]*?&:active:not\(:disabled\)|\.tactile-raised:active/,
    );
    expect(css).toMatch(/\.tactile-key\s*{[^}]*border-bottom-width: 2\.5px/);
  });

  it("self-hosts Geist and Geist Mono and uses them as the font stacks", async () => {
    const { css } = await build(["font-mono"]);

    expect(css).toContain("font-family: 'Geist Variable'");
    expect(css).toContain("font-family: 'Geist Mono Variable'");
    expect(css).toMatch(/url\(\.\/files\/geist-latin-wght-normal\.woff2\)/);
    expect(css).not.toMatch(/url\(["']?https?:/);
    expect(css).toMatch(/\.font-mono\s*{\s*font-family: "Geist Mono Variable"/);
  });

  it("keeps Tailwind's mobile-first breakpoints", async () => {
    const { css } = await build(["h-10", "sm:h-9"]);

    expect(css).toMatch(/@media \(width >= 40rem\)\s*{\s*\.sm\\:h-9/);
  });

  it("scans the kit's own sources so the app picks up its classes", async () => {
    const { compiler } = await build([]);

    expect(compiler.sources).toContainEqual(expect.objectContaining({ pattern: "./" }));
  });
});
