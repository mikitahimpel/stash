// What enrichment must never store: text that describes the lack of content instead of the
// content. A fetch that fails, or a consent page in place of a video, leaves the classifier with
// nothing to read, and a model asked to summarize nothing writes about the nothing.
//
// Migration `0006-link-image-and-repair.sql` (apps/api) repairs links stored before this filter
// existed, with the same lists in SQL.

/** Names of sites whose bare name is what a blocked or empty page has for a title. */
const siteNames = new Set(["youtube"]);

const edgeSeparators = /^[\s\-–—|·:•]+|[\s\-–—|·:•]+$/g;

/**
 * A page `<title>` that names only the site: `YouTube`, or `- YouTube`, where the part before the
 * separator (the video's name) is empty. Such a title says nothing about the link. A title that
 * merely starts with a separator (`- My notes`) is a title.
 */
export const isSiteNameTitle = (title: string): boolean => {
  const bare = title.replace(edgeSeparators, "");
  return bare === "" || siteNames.has(bare.toLowerCase());
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

// A meta-summary has the link's own content as its subject: "the topic cannot be determined", "the
// page text was unavailable". The patterns require that subject, because a real summary may well
// say that something else could not be determined, or that something is available somewhere. A
// false positive costs a real link its summary, so when in doubt a pattern does not match.
const subject = "(?:topic|subject|content|contents|title|text|page|video|link|transcript)";
const sentenceStart = "(?:^|[.!?;]\\s+)";

const metaSummaryPatterns: ReadonlyArray<RegExp> = [
  // "The topic of this video cannot be determined", "the content could not be fetched".
  new RegExp(
    `\\b${subject}\\b[^.!?]{0,60}\\b(?:cannot|can't|can not|could not|couldn't) be (?:determined|identified|classified|summari[sz]ed|accessed|fetched|retrieved|loaded)\\b`,
    "i",
  ),
  // "Unable to determine what this video is about", as the summary's own statement.
  new RegExp(
    `${sentenceStart}(?:it is |it's )?(?:unable|impossible|not possible) to (?:determine|identify|classify|summari[sz]e) (?:what (?:this|the) (?:video|link|page|content)\\b|(?:the|its) (?:topic|subject|content|contents)\\b)`,
    "i",
  ),
  // "The page text and title were unavailable", "its content is not available".
  new RegExp(
    `\\b${subject}\\b[^.!?]{0,40}\\b(?:(?:is|are|was|were) (?:unavailable|not available|not provided|missing)|(?:isn't|aren't|wasn't|weren't) (?:available|provided))\\b`,
    "i",
  ),
  // "No content was provided for this link."
  /\bno (?:content|text|title) (?:is |was |were |are )?(?:available|provided|given|found)\b/i,
  // «Невозможно определить тему видео», «Содержимое страницы недоступно».
  /(?:невозможно|не удалось|нельзя) (?:определить|установить) (?:тему|тематику|содержание|содержимое|о ч[её]м)/i,
  /(?:содержимое|содержание|текст|заголовок)(?: и заголовок| и текст)?(?: страницы| видео| ссылки)? (?:недоступ|отсутству)/i,
];

/**
 * A summary about the missing content rather than the link: "The page text and title were
 * unavailable, so the topic cannot be determined".
 */
export const isMetaSummary = (summary: string): boolean =>
  metaSummaryPatterns.some((pattern) => pattern.test(summary));
