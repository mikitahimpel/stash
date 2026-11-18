import * as Link from "@stash/contracts-domain/link";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as ContentHttp from "./content-http.ts";
import * as ContentText from "./content-text.ts";
import * as ParseXPost from "./parse-x-post.ts";
import * as XPostUrl from "@stash/backend-links/x-post-url";

// A post on X, read without x.com itself (its pages are an app shell behind a login wall):
//
// 1. The syndication endpoint, the public JSON behind embedded posts.
// 2. oEmbed, when syndication has no usable answer: the author and the text only.
// 3. Neither has it: the post is unavailable (deleted, protected, or X answers nothing here), and
//    the link keeps its URL.
//
// Transient failures (timeouts, 429, 5xx) fail after the policy's retries, so the link is read on
// a later delivery. The cron's last requeue stops that (see `enrich-link.ts`).

/**
 * The token the syndication endpoint expects next to an id. It is derived from the id alone, the
 * way X's own embed script does it.
 */
export const syndicationToken = (id: string): string =>
  ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");

export const syndicationUrl = (id: string): string =>
  `https://cdn.syndication.twimg.com/tweet-result?${new URLSearchParams({
    id,
    token: syndicationToken(id),
    lang: "en",
  }).toString()}`;

export const oembedUrl = (target: XPostUrl.Target): string =>
  `https://publish.twitter.com/oembed?${new URLSearchParams({
    url: `https://twitter.com/${target.handle}/status/${target.id}`,
    omit_script: "1",
    dnt: "true",
  }).toString()}`;

/** A post up to this long is its own summary. Longer ones get a written summary. */
export const maxShortPostLength = 280;

/** The first line of a post is cut to this many characters in the link's title. */
export const maxTitleLineLength = 140;

/** Whether the post's text stands in for a summary: all of it is there, and it is short. */
export const isShort = (post: Link.Post): boolean =>
  !post.long && post.text.trim() !== "" && post.text.length <= maxShortPostLength;

/** "<Name>: <first line of the text>", or the name alone for a post with no text. */
export const title = (post: Link.Post): string => {
  const line = post.text.trim().split("\n")[0]?.trim() ?? "";
  if (line === "") return `${post.author.name} (@${post.author.handle})`;
  const cut = ContentText.truncate(line, maxTitleLineLength);
  return `${post.author.name}: ${cut}${cut.length < line.length ? "…" : ""}`;
};

/** A row-sized rendition of a photo on X's image host. Other URLs stay as they are. */
const previewUrl = (url: string): string => {
  const parsed = new URL(url);
  if (parsed.hostname !== "pbs.twimg.com" || !parsed.pathname.startsWith("/media/")) return url;
  parsed.search = "?name=small";
  return parsed.href;
};

/** The first photo, or the poster of the first video. */
export const imageUrl = (post: Link.Post): Option.Option<string> =>
  Option.fromNullishOr(post.media[0]).pipe(
    Option.map((media) => (media.kind === "photo" ? previewUrl(media.url) : media.posterUrl)),
  );

const authorLine = (post: Link.QuotedPost): string =>
  `${post.author.name} (@${post.author.handle})`;

/** What search and the classifier read: who wrote it, the text, and the quoted post. */
export const searchText = (post: Link.Post): string =>
  [
    `${authorLine(post)}:`,
    post.text,
    ...(post.quoted === null ? [] : ["", `Quoted ${authorLine(post.quoted)}:`, post.quoted.text]),
  ]
    .join("\n")
    .trim();

/** A read post as a link's content. */
export const content = (
  post: Link.Post,
  language: Option.Option<string> = Option.none(),
): ContentText.ContentText => ({
  title: Option.some(title(post)),
  description: Option.none(),
  author: Option.some(`@${post.author.handle}`),
  imageUrl: imageUrl(post),
  language,
  text: searchText(post),
  source: "post",
  post,
});

/** A post nothing can be read of: no title or text, only the handle its URL names. */
export const unavailable = (target: XPostUrl.Target): ContentText.ContentText => ({
  title: Option.none(),
  description: Option.none(),
  author: target.handle === "i" ? Option.none() : Option.some(`@${target.handle}`),
  imageUrl: Option.none(),
  language: Option.none(),
  text: "",
  source: "metadata",
  post: {
    state: "unavailable",
    id: target.id,
    url: Link.Url.make(XPostUrl.postUrl(target.handle, target.id)),
  },
});

/** A page on X that is not a post (a profile, a search): nothing is fetched, nothing is known. */
export const nothing: ContentText.ContentText = {
  title: Option.none(),
  description: Option.none(),
  author: Option.none(),
  imageUrl: Option.none(),
  language: Option.none(),
  text: "",
  source: "metadata",
};

/** `None` when the source has no answer for good; fails when it may have one later. */
const ask = <A>(
  url: string,
  source: string,
  parse: (body: string) => Option.Option<A>,
): Effect.Effect<Option.Option<A>, ContentHttp.ContentFetchError, HttpClient.HttpClient> =>
  ContentHttp.getText(url, { accept: "application/json" }).pipe(
    Effect.map((response) => parse(response.body)),
    Effect.catchIf(
      (error) => !error.isTransient,
      (error) =>
        Effect.as(
          Effect.logWarning(`X ${source} has no answer (${error.reason} ${error.status ?? ""})`),
          Option.none<A>(),
        ),
    ),
  );

/**
 * Reads a post: syndication, then oEmbed, else "unavailable". Never fails for a post that is
 * gone; fails only when a source fails transiently.
 */
export const fetchXPost = (
  target: XPostUrl.Target,
): Effect.Effect<ContentText.ContentText, ContentHttp.ContentFetchError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const syndicated = yield* ask(
      syndicationUrl(target.id),
      "syndication",
      ParseXPost.parseSyndication,
    );
    if (Option.isSome(syndicated)) {
      return syndicated.value._tag === "Gone"
        ? unavailable(target)
        : content(syndicated.value.post, syndicated.value.language);
    }
    const embedded = yield* ask(oembedUrl(target), "oEmbed", (body) =>
      ParseXPost.parseOembed(body, target),
    );
    return Option.match(embedded, {
      onNone: () => unavailable(target),
      onSome: (post) => content(post),
    });
  }).pipe(Effect.withSpan("fetchXPost", { attributes: { postId: target.id } }));
