import type * as Link from "@stash/contracts-domain/link";

// Concise text for the model. Tools return the full link as structured content, so the text keeps
// only what the model needs to answer and to pass an id to the next tool call.

type EncodedLink = typeof Link.Link.Encoded;

const facts = (link: EncodedLink) =>
  [
    `id ${link.id}`,
    link.status,
    link.type,
    link.tags.length === 0 ? null : link.tags.map((tag) => `#${tag}`).join(" "),
  ]
    .filter((fact) => fact !== null)
    .join(", ");

/** One list entry: `- Title — url (id …, status, type, #tags)`, then the summary if there is one. */
export const line = (link: EncodedLink) => {
  const head = `- ${link.title === null ? link.url : `${link.title} — ${link.url}`} (${facts(link)})`;
  return link.summary === null ? head : `${head}\n  ${link.summary}`;
};

/** A list of links under `heading`, or `empty` when there are none. */
export const list = (heading: string, links: ReadonlyArray<EncodedLink>, empty: string) =>
  links.length === 0 ? empty : [heading, ...links.map(line)].join("\n");

/** Every field of one link that tells the model something. */
export const details = (link: EncodedLink) =>
  [
    link.title ?? link.url,
    `URL: ${link.url}`,
    link.canonicalUrl === null || link.canonicalUrl === link.url
      ? null
      : `Canonical URL: ${link.canonicalUrl}`,
    `ID: ${link.id}`,
    `Status: ${link.status}`,
    link.type === null ? null : `Type: ${link.type}`,
    link.tags.length === 0 ? null : `Tags: ${link.tags.join(", ")}`,
    link.language === null ? null : `Language: ${link.language}`,
    `Saved: ${link.createdAt}`,
    link.summary === null ? "Not enriched yet." : `Summary: ${link.summary}`,
  ]
    .filter((field) => field !== null)
    .join("\n");
