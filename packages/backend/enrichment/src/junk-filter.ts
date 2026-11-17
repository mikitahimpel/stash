// What enrichment must never store: text that describes the lack of content instead of the
// content. A fetch that fails, or a consent page in place of a video, leaves the classifier with
// nothing to read, and a model asked to summarize nothing writes about the nothing.
//
// Migration `0006-link-image-and-repair.sql` (apps/api) repairs links stored before this filter
// existed, with the same lists in SQL.

/** Names of sites whose bare name is what a blocked or empty page has for a title. */
const siteNames = new Set(["youtube"]);

const separators = "-–—|·:•";
const leadingSeparator = new RegExp(`^[${separators}]\\s`);
const edgeSeparators = new RegExp(`^[\\s${separators}]+|[\\s${separators}]+$`, "g");

/**
 * A page `<title>` that names only the site: `YouTube`, or `- YouTube`, where the part before the
 * separator (the video's name) is empty. Such a title says nothing about the link.
 */
export const isSiteNameTitle = (title: string): boolean => {
  const trimmed = title.trim();
  const bare = trimmed.replace(edgeSeparators, "");
  return bare === "" || leadingSeparator.test(trimmed) || siteNames.has(bare.toLowerCase());
};

const junkTags = new Set([
  "unclassified",
  "uncategorized",
  "unknown",
  "unknown topic",
  "unidentified topic",
  "unknown content",
  "missing title",
  "no title",
  "untitled",
  "missing content",
  "no content",
  "unavailable",
  "content unavailable",
]);

/** A tag that says the classifier had nothing to go on (`unclassified`, `missing title`, …). */
export const isJunkTag = (tag: string): boolean => junkTags.has(tag.trim().toLowerCase());

const metaSummaryPatterns: ReadonlyArray<RegExp> = [
  /\b(?:cannot|can't|can ?not|could ?n[o']t|couldn't|unable to|impossible to) (?:be )?(?:determine|identif|classif|summari[sz]|access|fetch|retriev)/i,
  /\b(?:content|text|title|page|transcript|description|information|details)\b[^.]{0,60}\b(?:is|are|was|were)(?: not|n't)? (?:un)?available\b/i,
  /\bno (?:content|text|title|information|details) (?:is |was |were |are )?(?:available|provided|given|found)\b/i,
  /\bcould not be (?:fetched|retrieved|loaded|accessed)\b/i,
  /\b(?:without|lacking|missing) (?:the |any )?(?:page )?(?:content|text|title)\b/i,
  /(?:невозможно|не удалось|нельзя) (?:определить|установить|получить|загрузить)/i,
  /(?:содержимое|текст|заголовок|страница)[^.]{0,40} (?:недоступ|отсутству)/i,
];

/**
 * A summary about the missing content rather than the link: "The page text and title were
 * unavailable, so the topic cannot be determined".
 */
export const isMetaSummary = (summary: string): boolean =>
  metaSummaryPatterns.some((pattern) => pattern.test(summary));
