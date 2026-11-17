import type * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import type * as ContentHttp from "./content-http.ts";
import type * as ContentText from "./content-text.ts";
import * as FetchPageText from "./fetch-page-text.ts";
import * as FetchYoutubeContent from "./fetch-youtube-content.ts";

/**
 * What can be read of any link: oEmbed metadata and the transcript for a YouTube video or
 * playlist, the page's text and preview image otherwise.
 */
export const fetchContent = (
  url: string,
): Effect.Effect<ContentText.ContentText, ContentHttp.ContentFetchError, HttpClient.HttpClient> =>
  Option.match(FetchYoutubeContent.target(url), {
    onNone: () => FetchPageText.fetchPageText(url),
    onSome: FetchYoutubeContent.fetchYoutubeContent,
  });

/**
 * What is known of a link with no request at all: a YouTube video's thumbnail, and otherwise
 * nothing. For a link whose fetches keep failing.
 */
export const withoutFetch = (url: string): Option.Option<ContentText.ContentText> =>
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
  );
