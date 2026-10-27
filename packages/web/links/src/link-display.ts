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

/** How long ago `date` was, short: `now`, `12m`, `5h`, `3d`. */
export const age = (date: DateTime.Utc, now: DateTime.Utc): string => {
  const ms = Math.max(0, DateTime.toEpochMillis(now) - DateTime.toEpochMillis(date));
  return ms < minute
    ? "now"
    : ms < hour
      ? `${Math.floor(ms / minute)}m`
      : ms < day
        ? `${Math.floor(ms / hour)}h`
        : `${Math.floor(ms / day)}d`;
};
