import * as Fs from "node:fs";
import * as Path from "node:path";
import { describe, expect, it } from "vitest";

// Feature code doesn't style controls or rows (packages/web/CLAUDE.md, "Rules"): heights,
// padding, margins, radii, borders, backgrounds, shadows, fonts and text sizes come from
// `@stash/web-ui`, so every page shows the same controls. Feature templates keep layout only:
// flex, grid, gap (on the spacing scale), widths, overflow, truncation, visibility at a breakpoint,
// and the kit's text roles and colors (`text-meta`, `text-muted-foreground`, …).

const appDir = Path.resolve(import.meta.dirname, "..");
const features = ["links", "search", "open-tabs", "settings", "auth"].map((name) =>
  Path.join(appDir, "node_modules", `@stash/web-${name}`, "src"),
);
const roots = [...features, Path.join(appDir, "src")];

const vueFiles = (dir: string): Array<string> =>
  Fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = Path.join(dir, entry.name);
    return entry.isDirectory() ? vueFiles(path) : entry.name.endsWith(".vue") ? [path] : [];
  });

/** The spacing scale (docs/design.md): 4 · 8 · 12 · 16 · 24 · 32 · 48 px. */
const scale = new Set(["0", "1", "2", "3", "4", "6", "8", "12"]);

const banned: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:min-|max-)?h-/, "height"],
  [/^size-/, "size"],
  [/^p[xytblrse]?-/, "padding"],
  [/^m[xytblrse]?-(?!auto$)/, "margin"],
  [/^rounded/, "radius"],
  [/^border/, "border"],
  [/^font-/, "font"],
  [/^text-(?:xs|sm|base|lg|\d?xl|\[)/, "text size outside the kit's roles"],
  [/^(?:leading|tracking)-/, "line height or tracking"],
  [/^(?:bg-|shadow|ring|outline|tactile-|underline|link-underline|decoration-)/, "surface"],
];

/** Why a class is not for feature code, or undefined when it is layout only. */
const violation = (token: string): string | undefined => {
  // The utility after its variants (`sm:`, `max-sm:`, `hover:`, `[&_svg]:` …), without `!` or `-`.
  const utility = token
    .split(/:(?![^[]*\])/)
    .at(-1)!
    .replace(/^!?-?/, "");
  for (const [pattern, why] of banned) if (pattern.test(utility)) return why;
  const gap = /^gap-(?:[xy]-)?(.+)$/.exec(utility);
  if (gap !== null && !scale.has(gap[1]!)) return "gap off the spacing scale";
  return undefined;
};

const literals = (source: string): Array<string> =>
  [...source.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`$]*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );

/** Every class a file sets: static `class`, string literals in `:class`, and script strings. */
const classesOf = (source: string): Array<string> => {
  const template = source.slice(source.indexOf("<template>"));
  const script = source.slice(0, source.indexOf("<template>"));
  const statics = [...template.matchAll(/\sclass="([^"]*)"/g)].map((match) => match[1] ?? "");
  const bound = [...template.matchAll(/\s:class="([^"]*)"/g)].flatMap((match) =>
    literals(match[1] ?? ""),
  );
  return [...statics, ...bound, ...literals(script)].flatMap((value) =>
    value.split(/\s+/).filter((token) => token !== ""),
  );
};

const files = roots.flatMap(vueFiles);

describe("feature classes", () => {
  it("finds the feature templates", () => {
    expect(files.some((file) => file.endsWith("settings-page.vue"))).toBe(true);
    expect(files.some((file) => file.endsWith("app-header.vue"))).toBe(true);
  });

  it("tells layout from styling", () => {
    for (const ok of ["flex", "gap-6", "sm:gap-x-4", "w-2/3", "max-w-prose", "max-sm:w-full"]) {
      expect(violation(ok), ok).toBeUndefined();
    }
    for (const ok of ["ml-auto", "text-meta", "text-muted-foreground", "hover:text-foreground"]) {
      expect(violation(ok), ok).toBeUndefined();
    }
    for (const bad of ["h-10", "sm:h-9", "px-3", "-ml-2.5", "rounded-lg", "font-mono"]) {
      expect(violation(bad), bad).toBeDefined();
    }
    for (const bad of ["text-[15px]", "text-xs", "border-b", "bg-surface", "gap-5", "py-4"]) {
      expect(violation(bad), bad).toBeDefined();
    }
  });

  it.each(files.map((file) => [Path.relative(appDir, file), file]))(
    "%s styles no controls or rows",
    (_, file) => {
      const source = Fs.readFileSync(file, "utf8");
      const found = classesOf(source)
        .map((token) => [token, violation(token)] as const)
        .filter(([, why]) => why !== undefined)
        .map(([token, why]) => `${token} (${why})`);
      expect(found).toEqual([]);
      expect(source).not.toContain("buttonVariants");
    },
  );
});
