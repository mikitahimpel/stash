import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// oxlint does not export its plugin types, so this declares the small subset the rule uses.
type Node = {
  readonly type: string;
  readonly source?: { readonly type: string; readonly value?: unknown } | null;
};

type Context = {
  readonly filename: string;
  readonly report: (descriptor: { readonly node: Node; readonly messageId: string }) => void;
};

const isRelative = (specifier: string) =>
  specifier === "." || specifier === ".." || /^\.\.?\//.test(specifier);

// The directory of the nearest package.json at or above `path`.
const packageRoot = (path: string): string | undefined => {
  for (let dir = path; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
};

// Same idea as eslint-plugin-import's `no-relative-packages`, which oxlint does not have:
// a relative import must resolve inside the importing file's own package.
const noRelativePackages = {
  meta: {
    type: "problem",
    docs: {
      description: "disallow relative imports that resolve into another package",
    },
    messages: {
      crossesPackage:
        "Relative import reaches into another package. Import it by its package name and public `exports` (see Context isolation rules in docs/architecture.md).",
    },
  },
  create(context: Context) {
    const own = packageRoot(dirname(context.filename));
    const check = (node: Node) => {
      const source = node.source;
      if (source?.type !== "Literal" || typeof source.value !== "string") return;
      if (!isRelative(source.value)) return;
      const target = packageRoot(resolve(dirname(context.filename), source.value));
      if (target !== own) context.report({ node: source, messageId: "crossesPackage" });
    };
    return {
      ImportDeclaration: check,
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
      ImportExpression: check,
    };
  },
};

export default {
  meta: { name: "stash" },
  rules: { "no-relative-packages": noRelativePackages },
};
