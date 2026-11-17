// What enrichment must never store: a title or a tag that describes the lack of content instead
// of the content. A fetch that fails, or a consent page in place of a video, leaves the classifier
// with nothing to read, and a model asked to classify nothing writes about the nothing.
//
// Summaries are not filtered here. Telling a summary about missing content from a real one ("why
// the cause could not be determined") by its wording is not reliable, and a wrong guess costs a
// real link its summary. The guarantee is structural instead (`classify-link.ts`): a link with no
// body text never gets the model's prose as its summary, and a link with text keeps what the
// model wrote.
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
