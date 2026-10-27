/** A piece of text, and whether it is one of the query's terms. */
export interface Part {
  readonly text: string;
  readonly match: boolean;
}

// Single letters (`a`, `в`) would light up most of a summary, so a term needs two.
const minTermLength = 2;

const escape = (term: string): string => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The distinct terms of `query`: its whitespace-separated words of two or more letters, compared
 * case-insensitively, longest first (so `rust` wins over `ru` where both match).
 */
export const terms = (query: string): ReadonlyArray<string> => {
  const seen = new Map<string, string>();
  for (const word of query.split(/\s+/u)) {
    const key = word.toLocaleLowerCase();
    if ([...word].length >= minTermLength && !seen.has(key)) seen.set(key, word);
  }
  return [...seen.values()].toSorted((a, b) => b.length - a.length);
};

/**
 * Splits `text` into the runs that match a term of `query` (case-insensitive, any script) and the
 * runs between them. Joining the parts gives back `text`; with no terms it is one plain part.
 */
export const split = (text: string, query: string): ReadonlyArray<Part> => {
  const found = terms(query);
  if (text === "" || found.length === 0) return text === "" ? [] : [{ text, match: false }];
  const pattern = new RegExp(found.map(escape).join("|"), "giu");
  const parts: Array<Part> = [];
  let last = 0;
  for (const hit of text.matchAll(pattern)) {
    if (hit.index > last) parts.push({ text: text.slice(last, hit.index), match: false });
    parts.push({ text: hit[0], match: true });
    last = hit.index + hit[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
};
