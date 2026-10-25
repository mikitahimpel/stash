import { Data, Effect, FileSystem, Path } from "effect";

/**
 * Reads the links kept in a Craft Markdown export: a folder of `.md` documents (one per Craft
 * doc, nested folders mirroring Craft folders, `*.assets/` folders for media). Every `http(s)` URL
 * is extracted with the context it was written in: the link text, the document title, the headings
 * above it and the surrounding line. Links are deduped by URL across the whole export, keeping
 * every place a link was found.
 */

export class CraftExportError extends Data.TaggedError("CraftExportError")<{
  readonly message: string;
}> {}

/** One place a link was written. */
export interface CraftLinkSource {
  /** Path of the document inside the export, with `/` separators. */
  readonly path: string;
  /** The document's title: its leading `# heading`, or the file name. */
  readonly document: string;
  /** The headings the link sits under, outermost first, without the document title. */
  readonly headings: ReadonlyArray<string>;
  /** The line the link is on as plain text, without the URL. */
  readonly context: string | null;
}

/** A link found in one document, before deduping. */
export interface CraftLinkOccurrence extends CraftLinkSource {
  readonly url: string;
  /** The Markdown link text, when the link has one that differs from the URL. */
  readonly title: string | null;
}

export interface CraftLink {
  readonly url: string;
  readonly title: string | null;
  /** Every place the link was found, in export order. Never empty. */
  readonly sources: ReadonlyArray<CraftLinkSource>;
}

export interface CraftDocument {
  readonly path: string;
  readonly markdown: string;
}

// A URL may contain one level of balanced parentheses (`https://example.com/a_(b)`).
const urlPattern = String.raw`https?:\/\/(?:[^\s()<>]|\([^\s()<>]*\))+`;
const markdownLinkPattern = new RegExp(
  String.raw`(!?)\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(\s*<?(${urlPattern})>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)`,
  "gi",
);
const autolinkPattern = new RegExp(String.raw`<(${urlPattern})>`, "gi");
const bareUrlPattern = /https?:\/\/[^\s<>"'`]+/gi;
const headingPattern = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const fencePattern = /^ {0,3}(`{3,}|~{3,})/;
const inlineCodePattern = /(`+)[^`]*?\1/g;
// Marks where a URL was taken out of a line, so the punctuation around it can be cleaned up.
const removed = "\u0000";

/** Cuts trailing punctuation and unbalanced closing brackets that end a sentence, not the URL. */
const trimBareUrl = (url: string): string => {
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    if (last === undefined) break;
    if (".,;:!?*_~'\"".includes(last)) {
      end--;
      continue;
    }
    const open = last === ")" ? "(" : last === "]" ? "[" : null;
    if (open !== null) {
      const head = url.slice(0, end);
      if (head.split(open).length < head.split(last).length) {
        end--;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
};

/** The URL in its normalized form (`new URL(...).href`), or null when it is not `http(s)`. */
const normalizeUrl = (raw: string): string | null => {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;
  return url.href;
};

const stripInlineMarkdown = (text: string): string =>
  text
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();

const nonEmpty = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/** The document title from a file path: its name without the `.md` extension. */
const fileTitle = (path: string): string => {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
};

interface LineLink {
  readonly url: string;
  readonly title: string | null;
}

/** Extracts the links on one line, and the line as plain text with the URLs taken out. */
const parseLine = (line: string): { links: ReadonlyArray<LineLink>; context: string | null } => {
  const links: Array<LineLink> = [];
  // Inline code is not prose: drop it before looking for links.
  let rest = line.replace(inlineCodePattern, " ");

  rest = rest.replace(markdownLinkPattern, (_match, bang: string, text: string, url: string) => {
    const label = stripInlineMarkdown(text);
    // Images are media, not links worth keeping; their alt text still gives context.
    if (bang !== "!") links.push({ url, title: label === "" || label === url ? null : label });
    return label;
  });
  rest = rest.replace(autolinkPattern, (_match, url: string) => {
    links.push({ url, title: null });
    return removed;
  });
  rest = rest.replace(bareUrlPattern, (match) => {
    const url = trimBareUrl(match);
    links.push({ url, title: null });
    return removed + match.slice(url.length);
  });

  const context = stripInlineMarkdown(
    rest
      // List markers, task boxes, block quotes.
      .replace(/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?/, "")
      // A URL that ends the line takes the punctuation around it ("See: <url>.") along.
      .replace(new RegExp(String.raw`[\s:–—-]*${removed}[\s.,;:!?]*$`), "")
      .replaceAll(removed, " ")
      .replace(/[\s:–—-]+$/, ""),
  );
  return { links, context: nonEmpty(context) };
};

/**
 * Parses one Markdown document of the export. Links inside fenced or inline code, image links and
 * non-`http(s)` URLs are skipped. The result is in document order and not deduped.
 */
export const parseDocument = (document: CraftDocument): ReadonlyArray<CraftLinkOccurrence> => {
  const path = document.path.replace(/\\/g, "/");
  const lines = document.markdown.replace(/^﻿/, "").split(/\r?\n/);
  const occurrences: Array<CraftLinkOccurrence> = [];

  let title: string | null = null;
  let sawContent = false;
  // Heading text per level (index 0 is `#`); levels below the latest heading are cleared.
  const headings: Array<string | undefined> = [];
  let fence: string | null = null;

  for (const line of lines) {
    const fenceMatch = fencePattern.exec(line);
    if (fence !== null) {
      if (fenceMatch !== null && fenceMatch[1]!.startsWith(fence)) fence = null;
      continue;
    }
    if (fenceMatch !== null) {
      fence = fenceMatch[1]!;
      continue;
    }

    const heading = headingPattern.exec(line);
    const parsed = parseLine(heading === null ? line : heading[2]!);
    if (heading !== null) {
      const level = heading[1]!.length;
      const text = parsed.context ?? "";
      // Craft writes the document title as the first line, a level-1 heading.
      if (level === 1 && title === null && !sawContent) {
        title = nonEmpty(text);
      } else {
        headings.length = level - 1;
        headings[level - 1] = nonEmpty(text) ?? undefined;
      }
    }
    if (line.trim() !== "") sawContent = true;

    for (const link of parsed.links) {
      const url = normalizeUrl(link.url);
      if (url === null) continue;
      occurrences.push({
        url,
        title: link.title,
        path,
        document: title ?? fileTitle(path),
        headings: headings.filter((h): h is string => h !== undefined),
        context: heading === null ? parsed.context : null,
      });
    }
  }
  return occurrences;
};

/**
 * Merges occurrences of the same URL into one link. The first occurrence decides the order and the
 * title; a later one only supplies the title when the earlier ones have none.
 */
export const dedupe = (
  occurrences: ReadonlyArray<CraftLinkOccurrence>,
): ReadonlyArray<CraftLink> => {
  const byUrl = new Map<string, { title: string | null; sources: Array<CraftLinkSource> }>();
  for (const { url, title, ...source } of occurrences) {
    const known = byUrl.get(url);
    if (known === undefined) {
      byUrl.set(url, { title, sources: [source] });
    } else {
      known.title ??= title;
      known.sources.push(source);
    }
  }
  return [...byUrl].map(([url, { title, sources }]) => ({ url, title, sources }));
};

/** Parses a set of documents, sorted by path so the result does not depend on the read order. */
export const parseDocuments = (documents: ReadonlyArray<CraftDocument>): ReadonlyArray<CraftLink> =>
  dedupe(
    [...documents]
      .map((document) => ({ ...document, path: document.path.replace(/\\/g, "/") }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .flatMap(parseDocument),
  );

/** Walks an export folder and parses every `.md` file in it, at any depth. */
export const parseExport = (
  directory: string,
): Effect.Effect<ReadonlyArray<CraftLink>, CraftExportError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs.readDirectory(directory, { recursive: true });
    const documents = yield* Effect.forEach(
      entries.filter((entry) => /\.md$/i.test(entry)),
      (entry) =>
        fs
          .readFileString(path.join(directory, entry))
          .pipe(Effect.map((markdown) => ({ path: entry, markdown }))),
    );
    return parseDocuments(documents);
  }).pipe(Effect.mapError((error) => new CraftExportError({ message: error.message })));
