import * as Option from "effect/Option";

/** Readable text for a link, the input to classification and embedding. */
export interface ContentText {
  readonly title: Option.Option<string>;
  readonly description: Option.Option<string>;
  /** An ISO 639-1 code such as `en`, when known. */
  readonly language: Option.Option<string>;
  readonly text: string;
  /** Where `text` came from. */
  readonly source: "page" | "transcript" | "description";
}

/** Cuts `text` to at most `maxLength` characters, at a word boundary when one is close. */
export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const space = cut.search(/\s\S*$/);
  return space > maxLength * 0.9 ? cut.slice(0, space) : cut;
};
