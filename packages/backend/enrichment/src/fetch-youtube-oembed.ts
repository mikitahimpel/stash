import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ContentHttp from "./content-http.ts";

// YouTube's oEmbed endpoint: public, keyless, and answered to data-center addresses, where the
// watch page is often a consent page. It is the source of truth for a video's or playlist's title.

/** What oEmbed says about a video or a playlist. */
export interface Oembed {
  readonly title: Option.Option<string>;
  /** The channel's name. */
  readonly authorName: Option.Option<string>;
  readonly thumbnailUrl: Option.Option<string>;
}

/** The oEmbed request for a YouTube page URL (a watch or playlist URL). */
export const oembedUrl = (pageUrl: string): string =>
  `https://www.youtube.com/oembed?${new URLSearchParams({ url: pageUrl, format: "json" }).toString()}`;

/** The parts of the oEmbed response used here. Everything is optional. */
const OembedResponse = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  author_name: Schema.optionalKey(Schema.String),
  thumbnail_url: Schema.optionalKey(Schema.String),
});

const decodeResponse = Schema.decodeUnknownOption(Schema.fromJsonString(OembedResponse));

const nonEmpty = (text: string | undefined): Option.Option<string> =>
  text === undefined || text.trim() === "" ? Option.none() : Option.some(text.trim());

/** Reads an oEmbed response body. `None` when it is not the expected JSON. */
export const parseOembed = (body: string): Option.Option<Oembed> =>
  decodeResponse(body).pipe(
    Option.map((response) => ({
      title: nonEmpty(response.title),
      authorName: nonEmpty(response.author_name),
      thumbnailUrl: nonEmpty(response.thumbnail_url),
    })),
  );

/**
 * Asks oEmbed about a YouTube page. `None` when YouTube has no answer for good: the video is
 * private or deleted (401, 403, 404), or the body is not oEmbed JSON. Transient failures (429,
 * 5xx, timeouts) fail after the policy's retries, so the link is enriched on a later delivery.
 */
export const fetchYoutubeOembed = (
  pageUrl: string,
): Effect.Effect<Option.Option<Oembed>, ContentHttp.ContentFetchError, HttpClient.HttpClient> =>
  ContentHttp.getText(oembedUrl(pageUrl), { accept: "application/json" }).pipe(
    Effect.map((response) => parseOembed(response.body)),
    Effect.catchIf(
      (error) => !error.isTransient,
      (error) =>
        Effect.as(
          Effect.logWarning(`YouTube oEmbed has no answer for ${pageUrl} (${error.reason})`),
          Option.none<Oembed>(),
        ),
    ),
  );
