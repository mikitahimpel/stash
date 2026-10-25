import * as Option from "effect/Option";

// A small pure HTML-to-text extractor. It uses only string operations, so it runs the same in
// Workers and in Node tests. It does not build a DOM: it picks the main region (`<article>`,
// `<main>` or `<body>`), drops non-content elements and turns block boundaries into line breaks.
// That is enough for classification and embedding input, which do not need exact layout.

export interface HtmlText {
  readonly title: Option.Option<string>;
  readonly description: Option.Option<string>;
  /** The `<html lang>` attribute as written, e.g. `en-US`. */
  readonly lang: Option.Option<string>;
  readonly text: string;
}

const namedEntities: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
};

/** Decodes numeric and common named character references. Unknown ones stay as written. */
export const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, ref: string) => {
    if (ref.startsWith("#")) {
      const code =
        ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return namedEntities[ref.toLowerCase()] ?? match;
  });

/** Collapses runs of whitespace into single spaces and trims. */
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

const nonEmpty = (text: string | undefined): Option.Option<string> => {
  const value = text === undefined ? "" : squash(decodeEntities(text));
  return value === "" ? Option.none() : Option.some(value);
};

/** The attributes of one start tag's source, keys lowercased. */
export const parseAttributes = (tag: string): Readonly<Record<string, string>> => {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  // Skip the tag name.
  const body = tag.replace(/^<\s*[^\s/>]+/, "");
  for (const match of body.matchAll(pattern)) {
    const name = match[1];
    if (name === undefined) continue;
    attributes[name.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
};

const metaContent = (html: string): ReadonlyMap<string, string> => {
  const meta = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(tag);
    const key = (attributes["name"] ?? attributes["property"])?.toLowerCase();
    const content = attributes["content"];
    if (key !== undefined && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  return meta;
};

/** The inner HTML of the first `<tag>…</tag>`, if any. */
const inner = (html: string, tag: string): string | undefined =>
  new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "i").exec(html)?.[1];

/** The inner HTML of the longest `<tag>…</tag>`, so a page of teasers keeps its main article. */
const longest = (html: string, tag: string): string | undefined => {
  let best: string | undefined;
  for (const match of html.matchAll(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "gi"),
  )) {
    const content = match[1] ?? "";
    if (best === undefined || content.length > best.length) best = content;
  }
  return best;
};

const dropped = [
  "head",
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "object",
  "canvas",
  "nav",
  "header",
  "footer",
  "aside",
];

const blockTags =
  "address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|h[1-6]|hr|li|main|ol|p|pre|section|table|td|th|tr|ul";

/** Readable text from an HTML region: one line per block, whitespace collapsed. */
export const toText = (html: string): string => {
  let text = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of dropped) {
    text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi"), " ");
  }
  // Source line breaks are whitespace; only block boundaries end a line.
  text = text
    .replace(/\s+/g, " ")
    .replace(new RegExp(`</?(?:${blockTags})\\b[^>]*>`, "gi"), "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map(squash)
    .filter((line) => line !== "")
    .join("\n");
};

/** Title, description, declared language and readable text of an HTML document. */
export const parse = (html: string): HtmlText => {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, " ");
  const meta = metaContent(withoutComments);
  const htmlTag = /<html\b[^>]*>/i.exec(withoutComments)?.[0];
  const region =
    longest(withoutComments, "article") ??
    inner(withoutComments, "main") ??
    inner(withoutComments, "body") ??
    withoutComments;
  return {
    title: nonEmpty(inner(withoutComments, "title")).pipe(
      Option.orElse(() => nonEmpty(meta.get("og:title"))),
    ),
    description: nonEmpty(meta.get("description")).pipe(
      Option.orElse(() => nonEmpty(meta.get("og:description"))),
      Option.orElse(() => nonEmpty(meta.get("twitter:description"))),
    ),
    lang: nonEmpty(htmlTag === undefined ? undefined : parseAttributes(htmlTag)["lang"]),
    text: toText(region),
  };
};
