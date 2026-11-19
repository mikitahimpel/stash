import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import type * as ContentHttp from "./content-http.ts";
import type * as ContentText from "./content-text.ts";
import * as FetchPageText from "./fetch-page-text.ts";
import * as FetchXPost from "./fetch-x-post.ts";
import * as FetchYoutubeContent from "./fetch-youtube-content.ts";
import * as XPostUrl from "@stash/backend-links/x-post-url";

type Fetched = Effect.Effect<
  ContentText.ContentText,
  ContentHttp.ContentFetchError,
  HttpClient.HttpClient
>;

/**
 * A link on X: the post from X's public endpoints, and nothing at all for any other page there
 * (a profile, a search). x.com's HTML is never fetched: it is an app shell behind a login wall.
 */
const fetchX = (url: string): Fetched =>
  Option.match(XPostUrl.target(url), {
    onNone: () => Effect.succeed(FetchXPost.nothing),
    onSome: FetchXPost.fetchXPost,
  });

/**
 * What can be read of any link: the post for a link to X, oEmbed metadata and the transcript for
 * a YouTube video or playlist, the page's text and preview image otherwise.
 */
export const fetchContent = (url: string): Fetched =>
  XPostUrl.isXHost(url)
    ? fetchX(url)
    : Option.match(FetchYoutubeContent.target(url), {
        onNone: () => FetchPageText.fetchPageText(url),
        onSome: FetchYoutubeContent.fetchYoutubeContent,
      });

/**
 * Only what a backfill needs, the preview image and the author: one oEmbed request for a YouTube
 * video or playlist (never the watch page), the post for a link to X, the page itself otherwise.
 */
export const fetchMetadata = (url: string): Fetched =>
  XPostUrl.isXHost(url)
    ? fetchX(url)
    : Option.match(FetchYoutubeContent.target(url), {
        onNone: () => FetchPageText.fetchPageText(url),
        onSome: FetchYoutubeContent.fetchYoutubeMetadata,
      });

/**
 * What is known of a link with no request at all: a YouTube video's thumbnail, that a post on X
 * is unavailable, and otherwise nothing. For a link whose fetches keep failing.
 */
export const withoutFetch = (url: string): Option.Option<ContentText.ContentText> =>
  XPostUrl.target(url).pipe(
    Option.map(FetchXPost.unavailable),
    Option.orElse(() =>
      FetchYoutubeContent.target(url).pipe(
        Option.filter((target) => target._tag === "Video"),
        Option.map((target) => ({
          title: Option.none(),
          description: Option.none(),
          author: Option.none(),
          imageUrl: Option.some(FetchYoutubeContent.thumbnailUrl(target.id)),
          language: Option.none(),
          text: "",
          source: "metadata" as const,
        })),
      ),
    ),
  );
