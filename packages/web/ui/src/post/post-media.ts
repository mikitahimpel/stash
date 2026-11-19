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

/** A single medium keeps its own shape between these: a tall one is cropped, never a tower. */
export const minRatio = 3 / 4;
export const maxRatio = 2.4;

/** The width over the height of the box a single medium gets. 16:9 when its size is unknown. */
export const ratio = (media: Media): number =>
  media.width === null || media.height === null || media.width <= 0 || media.height <= 0
    ? 16 / 9
    : Math.min(maxRatio, Math.max(minRatio, media.width / media.height));

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
