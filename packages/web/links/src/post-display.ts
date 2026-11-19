import type * as Link from "@stash/contracts-domain/link";
import type * as PostMediaItems from "@stash/web-ui/post-media-items";
import * as DateTime from "effect/DateTime";

// How a link to a post on X is shown: what the row and the post card read from `link.post`.

/** The post of a link, when it was read. */
export const available = (link: Link.Link): Link.Post | undefined =>
  link.post?.state === "available" ? link.post : undefined;

/** Whether the link is a post that could not be read (deleted, protected, no answer). */
export const isUnavailable = (link: Link.Link): boolean => link.post?.state === "unavailable";

export const unavailableTitle = "Post unavailable";
export const unavailableDescription =
  "It was deleted or made private, or X gave no answer. The link is kept.";

export const profileUrl = (handle: string): string => `https://x.com/${handle}`;

const onImageHost = (url: string, path: string): URL | undefined => {
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  return parsed.hostname === "pbs.twimg.com" && parsed.pathname.startsWith(path)
    ? parsed
    : undefined;
};

/**
 * The author's picture. X gives the 48px one (`…_normal.jpg`); `large` is its 200px rendition,
 * for the cover of a row. A picture from anywhere else stays as it is.
 */
export const avatar = (
  author: Link.PostAuthor,
  size: "small" | "large" = "small",
): string | null => {
  if (author.avatarUrl === null || size === "small") return author.avatarUrl;
  const parsed = onImageHost(author.avatarUrl, "/profile_images/");
  if (parsed === undefined) return author.avatarUrl;
  parsed.pathname = parsed.pathname.replace(/_normal(\.[a-z0-9]+)?$/i, "_200x200$1");
  return parsed.href;
};

/** A rendition of a photo on X's image host (`small` 680px, `medium` 1200, `large` 2048). */
const rendition = (url: string, name: "medium" | "large"): string => {
  const parsed = onImageHost(url, "/media/");
  if (parsed === undefined) return url;
  parsed.search = `?name=${name}`;
  return parsed.href;
};

/** The post's media for `<PostMedia>`: photos at the grid's size, with the large one to open. */
export const media = (post: Link.QuotedPost): ReadonlyArray<PostMediaItems.Media> =>
  post.media.map((item) =>
    item.kind === "photo"
      ? {
          kind: "photo",
          url: rendition(item.url, "medium"),
          fullUrl: rendition(item.url, "large"),
          width: item.width,
          height: item.height,
        }
      : item,
  );

/** Whether the row's preview is a video's poster. */
export const startsWithVideo = (post: Link.Post): boolean =>
  post.media[0] !== undefined && post.media[0].kind !== "photo";

const mediaWords = (post: Link.Post): string => {
  const [first] = post.media;
  if (first === undefined) return "";
  if (first.kind === "photo")
    return post.media.length === 1 ? "Photo" : `${post.media.length} photos`;
  return first.kind === "gif" ? "GIF" : "Video";
};

/** The post's words on one run, for a row's two lines. A post with no words names its media. */
export const rowText = (post: Link.Post): string => {
  const text = post.text.replace(/\s+/g, " ").trim();
  return text !== "" ? text : mediaWords(post);
};

const local = (date: DateTime.Utc) => DateTime.setZone(date, DateTime.zoneMakeLocal());

/** `Jan 2, 2026`: when the post was made, beside the author. */
export const day = (date: DateTime.Utc): string =>
  DateTime.format(local(date), { dateStyle: "medium", locale: "en" });

/** `3:04 AM · Jan 2, 2026`: the same, to the minute, under the post. */
export const moment = (date: DateTime.Utc): string =>
  `${DateTime.format(local(date), { timeStyle: "short", locale: "en" })} · ${day(date)}`;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

const counted = (count: number | null, one: string, many: string): ReadonlyArray<string> =>
  count === null ? [] : [`${compact.format(count)} ${count === 1 ? one : many}`];

/** The counts the source gave, quiet: `1.2K likes`, `56 replies`. */
export const counts = (post: Link.QuotedPost): ReadonlyArray<string> =>
  post.counts === null
    ? []
    : [
        ...counted(post.counts.replies, "reply", "replies"),
        ...counted(post.counts.likes, "like", "likes"),
      ];
