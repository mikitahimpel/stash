import * as MediaShape from "../media-fit/media-shape";

/** A photo of a post. `fullUrl` is the rendition the lightbox shows, when it differs. */
export interface Photo {
  readonly kind: "photo";
  readonly url: string;
  readonly fullUrl?: string | undefined;
  readonly width: number | null;
  readonly height: number | null;
}

/** A video or an animated GIF: its poster and, when there is one, an mp4. */
export interface Video {
  readonly kind: "video" | "gif";
  readonly posterUrl: string;
  readonly videoUrl: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export type Media = Photo | Video;

/** At most this many media are shown: a post has no more. */
export const maxMedia = 4;

/** The width over the height of a medium, or `undefined` when the source gave no size. */
export const ratio = (media: Media): number | undefined =>
  MediaShape.ratio(media.width, media.height);

/**
 * The ratio of the box a single medium gets: its own shape (16:9 when unknown), so it is shown
 * whole. The box's height is capped (`MediaShape.maxHeight`), so a tall one is never a tower: it
 * stands in the middle of the box. `compact` (a quoted post) is never taller than 16:9.
 */
export const boxRatio = (media: Media, compact = false): number => {
  const box = MediaShape.box(ratio(media));
  return compact ? Math.max(MediaShape.wide, box) : box;
};

const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * The document of the frame a video plays in. A `<video>` has no `referrerpolicy` of its own, so
 * the player is a document with `no-referrer` for everything it loads: the video's host learns
 * nothing about this page (and X's refuses a request that names another site).
 */
export const playerDocument = (video: Video): string =>
  video.videoUrl === null
    ? ""
    : [
        "<!doctype html>",
        '<meta name="referrer" content="no-referrer">',
        "<style>html,body{margin:0;height:100%;background:#000}video{display:block;width:100%;height:100%;object-fit:contain}</style>",
        `<video src="${escapeAttribute(video.videoUrl)}" poster="${escapeAttribute(video.posterUrl)}" controls autoplay playsinline${video.kind === "gif" ? " loop muted" : ""}></video>`,
      ].join("");
