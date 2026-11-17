import * as Option from "effect/Option";

/** Readable text for a link, the input to classification and embedding. */
export interface ContentText {
  readonly title: Option.Option<string>;
  readonly description: Option.Option<string>;
  /** Who published it, when the source names them: a YouTube channel. */
  readonly author: Option.Option<string>;
  /** An absolute `http(s)` URL of a preview image on the page's own host. */
  readonly imageUrl: Option.Option<string>;
  /** An ISO 639-1 code such as `en`, when known. */
  readonly language: Option.Option<string>;
  /** The body text, or `""` when only metadata (title, author, image) is known. */
  readonly text: string;
  /** Where `text` came from. `metadata` means there is no text. */
  readonly source: "page" | "transcript" | "description" | "metadata";
}

/** Cuts `text` to at most `maxLength` characters, at a word boundary when one is close. */
export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const space = cut.search(/\s\S*$/);
  return space > maxLength * 0.9 ? cut.slice(0, space) : cut;
};

/** The longest image URL kept. Longer ones are tracking-laden or not URLs at all. */
export const maxImageUrlLength = 2_000;

/**
 * An image reference from a page (`og:image`, a thumbnail) as an absolute URL, resolved against
 * the page's URL. `None` unless the result is `http(s)`, so `data:` and `javascript:` never pass.
 */
export const resolveImageUrl = (reference: string, base: string): Option.Option<string> => {
  const trimmed = reference.trim();
  if (trimmed === "" || !URL.canParse(trimmed, base)) return Option.none();
  const url = new URL(trimmed, base);
  if (url.protocol !== "https:" && url.protocol !== "http:") return Option.none();
  return url.href.length > maxImageUrlLength ? Option.none() : Option.some(url.href);
};
