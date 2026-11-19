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

/** Who published a link: a channel or an author, as one short line. */
export const LinkAuthor = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
);

/** An X handle without the `@`. */
export const PostHandle = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_]{1,30}$/, { message: "Expected an X handle" })),
);

export const PostAuthor = Schema.Struct({
  name: Schema.String,
  handle: PostHandle,
  avatarUrl: Schema.NullOr(Url),
  verified: Schema.Boolean,
});
export type PostAuthor = typeof PostAuthor.Type;

/**
 * A clickable part of a post's `text`: `text.slice(start, end)` (UTF-16 offsets, as in any JS
 * string) opens `url`. A link's `url` is the expanded address, a mention's is the profile, a
 * hashtag's or cashtag's is its page on X. Entities are in order and never overlap.
 */
export const PostEntity = Schema.Struct({
  kind: Schema.Literals(["link", "mention", "hashtag", "cashtag"]),
  start: Schema.Int,
  end: Schema.Int,
  url: Url,
});
export type PostEntity = typeof PostEntity.Type;

export const PostPhoto = Schema.Struct({
  kind: Schema.Literal("photo"),
  url: Url,
  /** The full size in pixels, when the source gives it. */
  width: Schema.NullOr(Schema.Int),
  height: Schema.NullOr(Schema.Int),
});
export type PostPhoto = typeof PostPhoto.Type;

/** A video or an animated GIF (a silent looping mp4): its poster and, when there is one, an mp4. */
export const PostVideo = Schema.Struct({
  kind: Schema.Literals(["video", "gif"]),
  posterUrl: Url,
  videoUrl: Schema.NullOr(Url),
  width: Schema.NullOr(Schema.Int),
  height: Schema.NullOr(Schema.Int),
  durationMs: Schema.NullOr(Schema.Int),
});
export type PostVideo = typeof PostVideo.Type;

export const PostMedia = Schema.Union([PostPhoto, PostVideo]);
export type PostMedia = typeof PostMedia.Type;

/** What the source counts. A count it does not give is `null`. */
export const PostCounts = Schema.Struct({
  likes: Schema.NullOr(Schema.Int),
  replies: Schema.NullOr(Schema.Int),
});
export type PostCounts = typeof PostCounts.Type;

const postFields = {
  /** The status id. */
  id: Schema.String,
  /** `https://x.com/<handle>/status/<id>`. */
  url: Url,
  author: PostAuthor,
  /** The post as displayed: links in their short display form, no trailing media link. */
  text: Schema.String,
  entities: Schema.Array(PostEntity),
  createdAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  media: Schema.Array(PostMedia),
  /** The handle the post replies to. */
  replyTo: Schema.NullOr(PostHandle),
  counts: Schema.NullOr(PostCounts),
  /** A long post ("note"): `text` is only its beginning. */
  long: Schema.Boolean,
};

/** A post quoted by another. It carries no quote of its own: one level only. */
export const QuotedPost = Schema.Struct(postFields);
export type QuotedPost = typeof QuotedPost.Type;

/** A post on X as it was read when the link was enriched. Media stay on X's hosts. */
export const Post = Schema.Struct({
  state: Schema.Literal("available"),
  ...postFields,
  quoted: Schema.NullOr(QuotedPost),
});
export type Post = typeof Post.Type;

/** A post that could not be read: deleted, protected, or X gave no answer. */
export const PostUnavailable = Schema.Struct({
  state: Schema.Literal("unavailable"),
  id: Schema.String,
  url: Url,
});
export type PostUnavailable = typeof PostUnavailable.Type;

/** What a link to a post on X holds besides the link's own fields. */
export const LinkPost = Schema.Union([Post, PostUnavailable]);
export type LinkPost = typeof LinkPost.Type;

/**
 * A saved link. Enrichment fills `type`, `summary`, `language`, `tags`, `imageUrl` and `author` later.
 * `imageUrl` is a preview image on the page's own host (an `og:image`, a video thumbnail), shown
 * as is: nothing proxies or stores it. `author` is who published it, when the source names them: a
 * YouTube channel, an article's author. `summary` stays `null` when the page gave no text to
 * summarize. `post` is set on a link to a post on X (absent on any other link): the
 * post itself, or the fact that it is unavailable. For a short post `summary` is the post's text.
 * `updatedAt` is when the link last changed (the save, enrichment, an edit, a tag): the api always
 * sends it, and of two copies of a link the one with the later `updatedAt` is current.
 */
export const Link = Schema.Struct({
  id: LinkId,
  url: Url,
  canonicalUrl: Schema.NullOr(Url),
  title: Schema.NullOr(LinkTitle),
  status: LinkStatus,
  type: Schema.NullOr(LinkType),
  summary: Schema.NullOr(Schema.String),
  language: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(Url),
  author: Schema.NullOr(LinkAuthor),
  tags: Schema.Array(Tag.TagName),
  sourceDeviceId: Schema.NullOr(Device.DeviceId),
  createdAt: Schema.DateTimeUtcFromString,
  enrichedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  post: Schema.optionalKey(LinkPost),
  updatedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
});
export type Link = typeof Link.Type;

/**
 * What a client sends to save a link. The source device comes from the caller's token. A caller
 * without a device token (the web `/save` page, signed in by the session cookie) may name the
 * device the save came from with `deviceId`, such as the iPhone whose Shortcut opened the page. The
 * api ignores it for a device token, and for a device that does not exist.
 */
export const SaveLinkInput = Schema.Struct({
  url: Url,
  title: Schema.optionalKey(LinkTitle),
  tags: Schema.optionalKey(Schema.Array(Tag.TagName)),
  deviceId: Schema.optionalKey(Device.DeviceId),
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
