import { Schema } from "effect";

/** A tag name: trimmed, lowercase, 1–64 characters. */
export const TagName = Schema.String.pipe(
  Schema.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(64),
    Schema.isTrimmed(),
    Schema.isPattern(/^[^A-Z]*$/, { message: "Expected a lowercase tag name" }),
  ),
  Schema.brand("TagName"),
);
export type TagName = typeof TagName.Type;

export const Tag = Schema.Struct({
  name: TagName,
  linkCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type Tag = typeof Tag.Type;
