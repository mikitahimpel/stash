import type * as SearchGroup from "@stash/contracts-api/search";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as Schema from "effect/Schema";

/** What the search form holds. An empty `type` or `tag` means "any". */
export interface Form {
  readonly q: string;
  readonly mode: SearchGroup.SearchMode;
  readonly type: Link.LinkType | "";
  readonly tag: string;
}

export const emptyForm: Form = { q: "", mode: "hybrid", type: "", tag: "" };

export const modes: ReadonlyArray<{
  readonly value: SearchGroup.SearchMode;
  readonly label: string;
}> = [
  { value: "hybrid", label: "Hybrid" },
  { value: "semantic", label: "Meaning" },
  { value: "keyword", label: "Keywords" },
];

/** Whether the mode matches words, so the results highlight the query's terms. */
export const matchesWords = (mode: SearchGroup.SearchMode): boolean => mode !== "semantic";

export const types: ReadonlyArray<Link.LinkType> = Link.LinkType.literals;

export const typeLabels: Readonly<Record<Link.LinkType, string>> = {
  article: "Article",
  video: "Video",
  tool: "Tool",
  repo: "Repo",
  other: "Other",
};

const maxQueryLength = 500;
const isTagName = Schema.is(Tag.TagName);
const isLinkType = Schema.is(Link.LinkType);

/**
 * The query parameters of `GET /search` for `form`, or `undefined` when there is nothing to search
 * for (a blank query). The query is trimmed and cut to the contract's maximum length, the tag is
 * trimmed and lowercased, and filters that are empty or invalid are left out.
 */
export const fromForm = (form: Form): SearchGroup.SearchQuery | undefined => {
  const q = form.q.trim().slice(0, maxQueryLength);
  if (q === "") return undefined;
  const tag = form.tag.trim().toLowerCase();
  return {
    q,
    mode: form.mode,
    ...(isLinkType(form.type) ? { type: form.type } : {}),
    ...(isTagName(tag) ? { tag } : {}),
  };
};

/** How many tags the page offers as filters. */
export const tagChipCount = 8;

/**
 * The tags to offer as filters: the most frequent among `links` (ties by name), and `selected`
 * when it isn't one of them, so the active filter can always be turned off.
 */
export const topTags = (
  links: ReadonlyArray<{ readonly tags: ReadonlyArray<string> }>,
  selected: string,
): ReadonlyArray<string> => {
  const counts = new Map<string, number>();
  for (const link of links)
    for (const name of link.tags) counts.set(name, (counts.get(name) ?? 0) + 1);
  const top = [...counts]
    .toSorted(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, tagChipCount)
    .map(([name]) => name);
  return selected === "" || top.includes(selected) ? top : [...top, selected];
};
