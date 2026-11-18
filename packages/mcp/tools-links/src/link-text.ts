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

type EncodedPost = NonNullable<EncodedLink["post"]>;

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

const mediaLine = (media: ReadonlyArray<{ readonly kind: string }>) => {
  const photos = media.filter((item) => item.kind === "photo").length;
  const videos = media.filter((item) => item.kind === "video").length;
  const gifs = media.filter((item) => item.kind === "gif").length;
  const parts = [
    photos === 0 ? null : plural(photos, "photo"),
    videos === 0 ? null : plural(videos, "video"),
    gifs === 0 ? null : plural(gifs, "GIF"),
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : `Media: ${parts.join(", ")}`;
};

/** A post on X as the model reads it: who wrote it, when, the text, and the post it quotes. */
const post = (value: EncodedPost): ReadonlyArray<string | null> => {
  if (value.state === "unavailable") {
    return ["Post on X: unavailable (deleted, protected, or X gave no answer)."];
  }
  const by = (author: { readonly name: string; readonly handle: string }) =>
    `${author.name} (@${author.handle})`;
  return [
    `Post on X by ${by(value.author)}${value.createdAt === null ? "" : `, ${value.createdAt}`}${
      value.replyTo === null ? "" : `, replying to @${value.replyTo}`
    }:`,
    value.text === "" ? null : value.text,
    value.long ? "(A long post: this is its beginning.)" : null,
    mediaLine(value.media),
    value.quoted === null ? null : `Quotes ${by(value.quoted.author)}: ${value.quoted.text}`,
  ];
};

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
    link.author === null ? null : `By: ${link.author}`,
    link.tags.length === 0 ? null : `Tags: ${link.tags.join(", ")}`,
    link.language === null ? null : `Language: ${link.language}`,
    `Saved: ${link.createdAt}`,
    link.imageUrl === null ? null : `Image: ${link.imageUrl}`,
    ...(link.post === undefined ? [] : post(link.post)),
    link.enrichedAt === null
      ? "Not enriched yet."
      : // A short post is its own summary: the text is above.
        link.summary === null ||
          (link.post?.state === "available" && link.summary === link.post.text)
        ? null
        : `Summary: ${link.summary}`,
  ]
    .filter((field) => field !== null)
    .join("\n");
