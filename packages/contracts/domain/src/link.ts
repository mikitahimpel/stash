import { Schema } from "effect";
import * as Device from "./device.ts";
import * as Tag from "./tag.ts";

export const LinkId = Schema.String.pipe(Schema.check(Schema.isNonEmpty()), Schema.brand("LinkId"));
export type LinkId = typeof LinkId.Type;

/** An absolute `http(s)` URL with no whitespace. */
export const Url = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^https?:\/\/[^\s/?#]+[^\s]*$/i, {
      message: "Expected an absolute http(s) URL",
    }),
  ),
  Schema.brand("Url"),
);
export type Url = typeof Url.Type;

export const LinkStatus = Schema.Literals(["new", "seen", "done", "archived"]);
export type LinkStatus = typeof LinkStatus.Type;

export const LinkType = Schema.Literals(["article", "video", "tool", "repo", "other"]);
export type LinkType = typeof LinkType.Type;

export const LinkTitle = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(1000)),
);

/** A saved link. Enrichment fills `type`, `summary`, `language` and `tags` later. */
export const Link = Schema.Struct({
  id: LinkId,
  url: Url,
  canonicalUrl: Schema.NullOr(Url),
  title: Schema.NullOr(LinkTitle),
  status: LinkStatus,
  type: Schema.NullOr(LinkType),
  summary: Schema.NullOr(Schema.String),
  language: Schema.NullOr(Schema.String),
  tags: Schema.Array(Tag.TagName),
  sourceDeviceId: Schema.NullOr(Device.DeviceId),
  createdAt: Schema.DateTimeUtcFromString,
  enrichedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type Link = typeof Link.Type;

/** What a client sends to save a link. The source device comes from the caller's token. */
export const SaveLinkInput = Schema.Struct({
  url: Url,
  title: Schema.optionalKey(LinkTitle),
  tags: Schema.optionalKey(Schema.Array(Tag.TagName)),
});
export type SaveLinkInput = typeof SaveLinkInput.Type;

/** A partial update of a link. Omitted fields stay unchanged. */
export const LinkPatch = Schema.Struct({
  title: Schema.optionalKey(LinkTitle),
  status: Schema.optionalKey(LinkStatus),
  type: Schema.optionalKey(LinkType),
  tags: Schema.optionalKey(Schema.Array(Tag.TagName)),
});
export type LinkPatch = typeof LinkPatch.Type;
