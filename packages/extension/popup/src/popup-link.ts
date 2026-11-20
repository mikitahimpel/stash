import type * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";

/** A saved link as the popup shows it: plain values, ready for a template. */
export interface PopupLink {
  readonly id: Link.LinkId;
  readonly url: string;
  /** The link's title, or its host when it has none yet. */
  readonly title: string;
  readonly host: string;
  /** The preview image from enrichment (`og:image`, a video thumbnail), if any. */
  readonly imageUrl: string | null;
  readonly tags: ReadonlyArray<string>;
  /** When it was saved, in epoch milliseconds. */
  readonly savedAt: number;
  /** Whether enrichment has run: until then `tags` and `imageUrl` may still arrive. */
  readonly enriched: boolean;
  /** The post on X the link points to, when it is one (`Link.post`); `null` for any other link. */
  readonly post: PopupPost | null;
}

/** A post on X as its row shows it: the author's line, then the post's words. */
export interface PostShown {
  readonly state: "available";
  readonly name: string;
  readonly handle: string;
  /** The author's picture, if any. */
  readonly avatarUrl: string | null;
  readonly verified: boolean;
  /** The post's words on one run, or what its media are when it has no words. */
  readonly text: string;
  /** The row's preview: the first photo, or the first video's poster. */
  readonly previewUrl: string | null;
  /** Whether the preview is a video's (or GIF's) poster. */
  readonly video: boolean;
}

/** A post that could not be read: deleted, protected, or X gave no answer. */
export interface PostUnavailable {
  readonly state: "unavailable";
}

export type PopupPost = PostShown | PostUnavailable;

export const unavailableTitle = "Post unavailable";

const mediaWords = (media: ReadonlyArray<Link.PostMedia>): string => {
  const [first] = media;
  if (first === undefined) return "";
  if (first.kind === "photo") return media.length === 1 ? "Photo" : `${media.length} photos`;
  return first.kind === "gif" ? "GIF" : "Video";
};

export const fromPost = (post: Link.LinkPost): PopupPost => {
  if (post.state === "unavailable") return { state: "unavailable" };
  const [first] = post.media;
  const text = post.text.replace(/\s+/g, " ").trim();
  return {
    state: "available",
    name: post.author.name,
    handle: post.author.handle,
    avatarUrl: post.author.avatarUrl,
    verified: post.author.verified,
    text: text !== "" ? text : mediaWords(post.media),
    previewUrl: first === undefined ? null : first.kind === "photo" ? first.url : first.posterUrl,
    video: first !== undefined && first.kind !== "photo",
  };
};

/** The host of a URL without `www.`, or the URL itself when it does not parse. */
export const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export const fromLink = (link: Link.Link): PopupLink => ({
  id: link.id,
  url: link.url,
  title: link.title ?? (link.post?.state === "unavailable" ? unavailableTitle : host(link.url)),
  host: host(link.url),
  imageUrl: link.imageUrl,
  tags: link.tags,
  savedAt: DateTime.toEpochMillis(link.createdAt),
  enriched: link.enrichedAt !== null,
  post: link.post === undefined ? null : fromPost(link.post),
});

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** How long ago `savedAt` was, in one short unit: `now`, `5m`, `3h`, `2d`, `6w`, `2y`. */
export const age = (savedAt: number, now: number): string => {
  const elapsed = Math.max(0, now - savedAt);
  if (elapsed < minute) return "now";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h`;
  if (elapsed < 14 * day) return `${Math.floor(elapsed / day)}d`;
  if (elapsed < 365 * day) return `${Math.floor(elapsed / (7 * day))}w`;
  return `${Math.floor(elapsed / (365 * day))}y`;
};
