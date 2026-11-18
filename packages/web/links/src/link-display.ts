import type * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";

/** The host a link points to, without `www.`. Prefers the canonical URL. */
export const domain = (link: Link.Link): string =>
  new URL(link.canonicalUrl ?? link.url).hostname.replace(/^www\./, "");

/** The title, or the URL while enrichment hasn't filled one in. */
export const title = (link: Link.Link): string => link.title ?? link.url;

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

/** How many tags a row shows before `+n`. */
export const maxRowTags = 3;

/** The tags a row shows, and how many it leaves out. */
export const shownTags = <T>(
  tags: ReadonlyArray<T>,
): { readonly shown: ReadonlyArray<T>; readonly more: number } => ({
  shown: tags.slice(0, maxRowTags),
  more: Math.max(0, tags.length - maxRowTags),
});

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
