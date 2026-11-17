import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import type * as ContentHttp from "./content-http.ts";
import * as ContentText from "./content-text.ts";
import * as FetchYoutubeOembed from "./fetch-youtube-oembed.ts";
import * as FetchYoutubeTranscript from "./fetch-youtube-transcript.ts";

// What is known about a YouTube link, from sources that work from a Worker:
//
// - oEmbed: the title and the channel. The source of truth for the title.
// - The thumbnail: a fixed URL per video id, no request needed.
// - The watch page: the transcript or the description, best effort. YouTube often blocks it, and
//   then the link is classified from its title and channel alone.

/** A YouTube page enrichment knows how to read. */
export type Target =
  | { readonly _tag: "Video"; readonly id: string }
  | { readonly _tag: "Playlist"; readonly id: string };

/** The video or playlist a URL points at, if it is a YouTube one. */
export const target = (url: string): Option.Option<Target> =>
  FetchYoutubeTranscript.videoId(url).pipe(
    Option.map((id): Target => ({ _tag: "Video", id })),
    Option.orElse(() =>
      Option.map(FetchYoutubeTranscript.playlistId(url), (id): Target => ({
        _tag: "Playlist",
        id,
      })),
    ),
  );

/** The page oEmbed is asked about: the plain watch or playlist URL, whatever form was saved. */
export const pageUrl = (target: Target): string =>
  target._tag === "Video"
    ? `https://www.youtube.com/watch?v=${target.id}`
    : `https://www.youtube.com/playlist?list=${target.id}`;

/** A video's thumbnail (480×360). It exists for every video. */
export const thumbnailUrl = (videoId: string): string =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

const transcript = (id: string) =>
  FetchYoutubeTranscript.fetchYoutubeTranscript(id).pipe(
    Effect.map(Option.some),
    Effect.catch((error) =>
      Effect.as(
        Effect.logWarning(`YouTube watch page skipped for ${id} (${error.reason})`),
        Option.none<FetchYoutubeTranscript.Transcript>(),
      ),
    ),
  );

/**
 * Title, channel, thumbnail and, when YouTube allows, the transcript or description of a video;
 * title, channel and thumbnail of a playlist. Fails only when oEmbed fails transiently.
 */
export const fetchYoutubeContent = (
  target: Target,
): Effect.Effect<ContentText.ContentText, ContentHttp.ContentFetchError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const page = pageUrl(target);
    const oembed = yield* FetchYoutubeOembed.fetchYoutubeOembed(page);
    const oembedTitle = Option.flatMap(oembed, (o) => o.title);
    const author = Option.flatMap(oembed, (o) => o.authorName);
    if (target._tag === "Playlist") {
      return {
        title: oembedTitle,
        description: Option.none(),
        author,
        imageUrl: oembed.pipe(
          Option.flatMap((o) => o.thumbnailUrl),
          Option.flatMap((thumbnail) => ContentText.resolveImageUrl(thumbnail, page)),
        ),
        language: Option.none(),
        text: "",
        source: "metadata" as const,
      };
    }
    const watched = yield* transcript(target.id);
    const body = Option.filter(watched, (w) => w.text !== "");
    return {
      title: Option.orElse(oembedTitle, () => Option.flatMap(watched, (w) => w.title)),
      description: Option.flatMap(watched, (w) => w.description),
      author,
      imageUrl: Option.some(thumbnailUrl(target.id)),
      language: Option.flatMap(body, (w) => w.language),
      text: Option.match(body, { onNone: () => "", onSome: (w) => w.text }),
      source: Option.match(body, { onNone: () => "metadata" as const, onSome: (w) => w.source }),
    };
  });
