import type * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import type * as ContentHttp from "./content-http.ts";
import type * as ContentText from "./content-text.ts";
import * as FetchPageText from "./fetch-page-text.ts";
import * as FetchYoutubeTranscript from "./fetch-youtube-transcript.ts";

/** Readable text for any link: the transcript for a YouTube video, the page text otherwise. */
export const fetchContent = (
  url: string,
): Effect.Effect<ContentText.ContentText, ContentHttp.ContentFetchError, HttpClient.HttpClient> =>
  Option.match(FetchYoutubeTranscript.videoId(url), {
    onNone: () => FetchPageText.fetchPageText(url),
    onSome: FetchYoutubeTranscript.fetchYoutubeTranscript,
  });
