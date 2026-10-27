import { Schema } from "effect";
import * as Link from "./link.ts";
import * as Tag from "./tag.ts";

const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const DigestTotals = Schema.Struct({
  saved: Count,
  seen: Count,
  done: Count,
  archived: Count,
});
export type DigestTotals = typeof DigestTotals.Type;

export const DigestTag = Schema.Struct({
  name: Tag.TagName,
  count: Count,
});
export type DigestTag = typeof DigestTag.Type;

export const DigestType = Schema.Struct({
  type: Link.LinkType,
  count: Count,
});
export type DigestType = typeof DigestType.Type;

export const DigestHighlight = Schema.Struct({
  linkId: Link.LinkId,
  url: Link.Url,
  title: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(Schema.String),
});
export type DigestHighlight = typeof DigestHighlight.Type;

/** A summary of what happened to links over one period (weekly by default). */
export const Digest = Schema.Struct({
  periodStart: Schema.DateTimeUtcFromString,
  periodEnd: Schema.DateTimeUtcFromString,
  generatedAt: Schema.DateTimeUtcFromString,
  totals: DigestTotals,
  topTags: Schema.Array(DigestTag),
  /** Links of the period by type, most first. Links not classified yet are left out. */
  topTypes: Schema.Array(DigestType),
  highlights: Schema.Array(DigestHighlight),
});
export type Digest = typeof Digest.Type;
