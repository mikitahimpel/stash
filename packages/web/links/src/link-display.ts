import type * as Link from "@stash/contracts-domain/link";

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

export const statusLabels: Readonly<Record<Link.LinkStatus, string>> = {
  new: "New",
  seen: "Seen",
  done: "Done",
  archived: "Archived",
};
