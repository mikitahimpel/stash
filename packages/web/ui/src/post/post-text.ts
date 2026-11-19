/** A clickable part of a text: `text.slice(start, end)` opens `url`. */
export interface TextEntity {
  readonly start: number;
  readonly end: number;
  readonly url: string;
}

/** A run of a text: plain, or a link. */
export interface TextPart {
  readonly text: string;
  readonly url?: string;
}

/**
 * The text cut into plain runs and links. An entity that overlaps an earlier one, or reaches
 * outside the text, stays plain text: nothing is shown twice and nothing is lost.
 */
export const parts = (
  text: string,
  entities: ReadonlyArray<TextEntity>,
): ReadonlyArray<TextPart> => {
  const result: Array<TextPart> = [];
  let at = 0;
  for (const entity of [...entities].sort((a, b) => a.start - b.start)) {
    if (entity.start < at || entity.end <= entity.start || entity.end > text.length) continue;
    if (entity.start > at) result.push({ text: text.slice(at, entity.start) });
    result.push({ text: text.slice(entity.start, entity.end), url: entity.url });
    at = entity.end;
  }
  if (at < text.length) result.push({ text: text.slice(at) });
  return result;
};
