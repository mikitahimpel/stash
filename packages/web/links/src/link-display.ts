import type * as Link from "@stash/contracts-domain/link";
import * as SiteTitle from "@stash/web-ui/site-title";
import * as DateTime from "effect/DateTime";
import * as YoutubeEmbed from "./details/youtube-embed.ts";
import * as PostDisplay from "./post-display.ts";

/** The host a link points to, without `www.`. Prefers the canonical URL. */
export const domain = (link: Link.Link): string =>
  new URL(link.canonicalUrl ?? link.url).hostname.replace(/^www\./, "");

/**
 * The preview image: the link's own, else the thumbnail of the YouTube video it points to. `null`
 * for any other link without one, which gets the generated cover.
 */
export const image = (link: Link.Link): string | null =>
  link.imageUrl !== null && link.imageUrl !== ""
    ? link.imageUrl
    : (YoutubeEmbed.thumbnail(link.url) ??
      (link.canonicalUrl === null ? undefined : YoutubeEmbed.thumbnail(link.canonicalUrl)) ??
      null);

/**
 * The title, or the URL while enrichment hasn't filled one in. A post that could not be read and
 * has no title says so.
 */
export const title = (link: Link.Link): string =>
  link.title ?? (PostDisplay.isUnavailable(link) ? PostDisplay.unavailableTitle : link.url);

/**
 * The title as a row shows it: without the site's own name before or after it
 * (`GitHub - … · GitHub`). The link's page and the stored title keep the whole of it.
 */
export const rowTitle = (link: Link.Link): string =>
  SiteTitle.strip(title(link), link.canonicalUrl ?? link.url);

/**
 * The one line under a row's meta: the summary, else who published the link, else nothing (the
 * line stays, empty, so every row has the same height). A post that could not be read says so.
 */
export const rowSummary = (link: Link.Link): string =>
  link.summary !== null && link.summary.trim() !== ""
    ? link.summary
    : PostDisplay.isUnavailable(link)
      ? link.title !== null
        ? PostDisplay.unavailableTitle
        : PostDisplay.unavailableDescription
      : (link.author ?? "");

export const typeLabels: Readonly<Record<Link.LinkType, string>> = {
  article: "Article",
  video: "Video",
  tool: "Tool",
  repo: "Repo",
  other: "Other",
};

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** How many tags a row shows at most before `+n`; a narrow row shows fewer. */
export const maxRowTags = 3;

/** How long ago `date` was, short: `now`, `12m`, `5h`, `3d`, `2w`, `4mo`, `1y`. */
export const age = (date: DateTime.Utc, now: DateTime.Utc): string => {
  const ms = Math.max(0, DateTime.toEpochMillis(now) - DateTime.toEpochMillis(date));
  return ms < minute
    ? "now"
    : ms < hour
      ? `${Math.floor(ms / minute)}m`
      : ms < day
        ? `${Math.floor(ms / hour)}h`
        : ms < 14 * day
          ? `${Math.floor(ms / day)}d`
          : ms < 60 * day
            ? `${Math.floor(ms / (7 * day))}w`
            : ms < 365 * day
              ? `${Math.floor(ms / (30 * day))}mo`
              : `${Math.floor(ms / (365 * day))}y`;
};
