import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ContentHttp from "./content-http.ts";
import * as ContentText from "./content-text.ts";
import * as DetectLanguage from "./detect-language.ts";
import * as HtmlText from "./html-text.ts";

// YouTube has no public, keyless transcript API. The approach:
//
// 1. Fetch the watch page (`https://www.youtube.com/watch?v=<id>`) and read the
//    `ytInitialPlayerResponse` JSON embedded in it. It holds the title, the description and the
//    caption tracks (`captions.playerCaptionsTracklistRenderer.captionTracks`), each with a
//    signed `baseUrl` to the timedtext endpoint.
// 2. Pick a track: a manual one over an auto-generated (`kind: "asr"`) one, and the video's own
//    language first when YouTube names it.
// 3. Fetch the track's `baseUrl`. It answers with timedtext XML, either `<text>` cues (format 1)
//    or `<p>` cues (format 3). The cue texts, joined, are the transcript.
//
// This is best effort. To data-center addresses (Cloudflare's among them) YouTube often answers
// the watch page with a consent or bot-check page: a 200 with no video in it. That fails as
// `Blocked`, and nothing of that page is used, least of all its `<title>` ("- YouTube"). The
// title comes from oEmbed instead (see `fetch-youtube-content.ts`). YouTube also changes this
// markup without notice and sometimes refuses timedtext requests: any failure after step 1 (no
// tracks, a failed or empty caption fetch) falls back to the description.

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "www.youtube-nocookie.com",
]);

const playlistIdPattern = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * The playlist id of a YouTube playlist page (`/playlist?list=<id>`), if it is one. A video opened
 * inside a playlist (`/watch?v=…&list=…`) is a video.
 */
export const playlistId = (url: string): Option.Option<string> => {
  if (!URL.canParse(url)) return Option.none();
  const parsed = new URL(url);
  if (!youtubeHosts.has(parsed.hostname.toLowerCase())) return Option.none();
  if (parsed.pathname.replace(/\/+$/, "") !== "/playlist") return Option.none();
  const id = parsed.searchParams.get("list");
  return id !== null && playlistIdPattern.test(id) ? Option.some(id) : Option.none();
};

/** The video id of a YouTube URL (`watch`, `shorts`, `embed`, `live`, `youtu.be`), if it is one. */
export const videoId = (url: string): Option.Option<string> => {
  if (!URL.canParse(url)) return Option.none();
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
  let id: string | null | undefined;
  if (host === "youtu.be") {
    id = segments[0];
  } else if (youtubeHosts.has(host)) {
    if (segments[0] === "watch") id = parsed.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(segments[0] ?? "")) id = segments[1];
  }
  return typeof id === "string" && videoIdPattern.test(id) ? Option.some(id) : Option.none();
};

export const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}&hl=en`;

const CaptionTrack = Schema.Struct({
  baseUrl: Schema.String,
  languageCode: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
});
type CaptionTrack = typeof CaptionTrack.Type;

/** The parts of `ytInitialPlayerResponse` used here. Everything is optional. */
const PlayerResponse = Schema.Struct({
  videoDetails: Schema.optionalKey(
    Schema.Struct({
      title: Schema.optionalKey(Schema.String),
      shortDescription: Schema.optionalKey(Schema.String),
    }),
  ),
  microformat: Schema.optionalKey(
    Schema.Struct({
      playerMicroformatRenderer: Schema.optionalKey(
        Schema.Struct({ defaultAudioLanguage: Schema.optionalKey(Schema.String) }),
      ),
    }),
  ),
  captions: Schema.optionalKey(
    Schema.Struct({
      playerCaptionsTracklistRenderer: Schema.optionalKey(
        Schema.Struct({ captionTracks: Schema.optionalKey(Schema.Array(CaptionTrack)) }),
      ),
    }),
  ),
});
type PlayerResponse = typeof PlayerResponse.Type;

const decodePlayerResponse = Schema.decodeUnknownOption(PlayerResponse);

/**
 * The JSON object literal that follows `marker` in `source`, found by matching braces outside of
 * strings. `None` when the marker is missing or the object does not parse.
 */
export const extractJsonObject = (source: string, marker: string): Option.Option<unknown> => {
  const markerAt = source.indexOf(marker);
  if (markerAt === -1) return Option.none();
  const start = source.indexOf("{", markerAt + marker.length);
  if (start === -1) return Option.none();
  let depth = 0;
  let inString = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}" && --depth === 0) {
      try {
        return Option.some(JSON.parse(source.slice(start, i + 1)));
      } catch {
        return Option.none();
      }
    }
  }
  return Option.none();
};

/** The player response embedded in a watch page. */
export const parsePlayerResponse = (html: string): Option.Option<PlayerResponse> =>
  extractJsonObject(html, "ytInitialPlayerResponse").pipe(Option.flatMap(decodePlayerResponse));

/** A manual track over an auto-generated one; within each, the video's language first. */
export const pickTrack = (
  tracks: ReadonlyArray<CaptionTrack>,
  language: Option.Option<string>,
): Option.Option<CaptionTrack> => {
  const rank = (track: CaptionTrack) =>
    (track.kind === "asr" ? 2 : 0) +
    (Option.isSome(language) && track.languageCode?.split("-")[0] === language.value ? 0 : 1);
  const sorted = [...tracks].sort((a, b) => rank(a) - rank(b));
  return Option.fromNullishOr(sorted[0]);
};

/** The text of a timedtext XML document (format 1 `<text>` or format 3 `<p>` cues). */
export const parseTimedText = (xml: string): string => {
  const cues = [...xml.matchAll(/<(text|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  return (
    cues
      // Cue text is XML-escaped, and often HTML-escaped inside that (`&amp;#39;`), so decode twice.
      .map((cue) =>
        HtmlText.decodeEntities(HtmlText.decodeEntities((cue[2] ?? "").replace(/<[^>]*>/g, "")))
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((line) => line !== "")
      .join("\n")
  );
};

const nonEmpty = (text: string | undefined): Option.Option<string> =>
  text === undefined || text.trim() === "" ? Option.none() : Option.some(text.trim());

/** What the watch page gave: the transcript, or the description when there are no captions. */
export interface Transcript {
  readonly title: Option.Option<string>;
  readonly description: Option.Option<string>;
  /** The caption track's language, or a guess from the text. */
  readonly language: Option.Option<string>;
  /** `""` when the video has neither captions nor a description. */
  readonly text: string;
  readonly source: "transcript" | "description";
}

/**
 * Fetches a YouTube video's transcript, falling back to its description (see the comment at the
 * top of this module). A consent or bot-check page in place of the video fails as `Blocked`.
 */
export const fetchYoutubeTranscript = (
  id: string,
): Effect.Effect<Transcript, ContentHttp.ContentFetchError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const policy = yield* ContentHttp.FetchPolicy;
    const url = watchUrl(id);
    const page = yield* ContentHttp.getText(url, {
      "accept-language": "en",
      // Skips the EU cookie-consent interstitial, which has no player response.
      cookie: "CONSENT=YES+1",
    });
    const player = parsePlayerResponse(page.body);
    const details = player.pipe(Option.flatMapNullishOr((p) => p.videoDetails));
    // No video in the page: a consent page, a bot check, or markup this parser no longer knows.
    if (Option.isNone(details)) {
      return yield* new ContentHttp.ContentFetchError({ url, reason: "Blocked" });
    }
    const title = nonEmpty(details.value.title);
    const description = nonEmpty(details.value.shortDescription);
    const audioLanguage = player.pipe(
      Option.flatMapNullishOr(
        (p) => p.microformat?.playerMicroformatRenderer?.defaultAudioLanguage,
      ),
      Option.flatMap(DetectLanguage.normalizeTag),
    );
    const track = player.pipe(
      Option.flatMapNullishOr((p) => p.captions?.playerCaptionsTracklistRenderer?.captionTracks),
      Option.flatMap((tracks) => pickTrack(tracks, audioLanguage)),
    );

    const transcript = Option.isNone(track)
      ? Option.none<string>()
      : yield* ContentHttp.getText(track.value.baseUrl).pipe(
          Effect.map((response) => nonEmpty(parseTimedText(response.body))),
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning("YouTube transcript fetch failed, using the description", error),
              Option.none<string>(),
            ),
          ),
        );

    if (Option.isSome(transcript) && Option.isSome(track)) {
      const text = ContentText.truncate(transcript.value, policy.maxTextLength);
      return {
        title,
        description,
        language: Option.fromNullishOr(track.value.languageCode).pipe(
          Option.flatMap(DetectLanguage.normalizeTag),
          Option.orElse(() => DetectLanguage.detect(text)),
        ),
        text,
        source: "transcript" as const,
      };
    }
    const text = ContentText.truncate(
      Option.getOrElse(description, () => ""),
      policy.maxTextLength,
    );
    return {
      title,
      description,
      language: DetectLanguage.detect(text).pipe(Option.orElse(() => audioLanguage)),
      text,
      source: "description" as const,
    };
  });
