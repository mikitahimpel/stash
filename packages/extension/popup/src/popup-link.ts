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
}

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
  title: link.title ?? host(link.url),
  host: host(link.url),
  imageUrl: link.imageUrl,
  tags: link.tags,
  savedAt: DateTime.toEpochMillis(link.createdAt),
  enriched: link.enrichedAt !== null,
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
