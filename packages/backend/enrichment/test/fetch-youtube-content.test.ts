import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FetchYoutubeContent from "../src/fetch-youtube-content.ts";
import * as FetchYoutubeOembed from "../src/fetch-youtube-oembed.ts";
import * as FetchYoutubeTranscript from "../src/fetch-youtube-transcript.ts";
import * as EnrichmentTestLayer from "./enrichment-test-layer.ts";
import * as FakeHttp from "./fake-http.ts";
import * as Fixtures from "./fixtures.ts";

const id = Fixtures.videoId;
const video = { _tag: "Video", id } as const;
const playlist = { _tag: "Playlist", id: Fixtures.playlistId } as const;
const watch = FetchYoutubeTranscript.watchUrl(id);
const oembed = FetchYoutubeOembed.oembedUrl(FetchYoutubeContent.pageUrl(video));
const playlistOembed = FetchYoutubeOembed.oembedUrl(FetchYoutubeContent.pageUrl(playlist));
const [, , enTrack] = Fixtures.tracks;
const json = "application/json";
const thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

describe("FetchYoutubeContent.target", () => {
  it.each([
    ["a watch URL", `https://www.youtube.com/watch?v=${id}&t=42s`],
    ["a Short", `https://www.youtube.com/shorts/${id}`],
    ["youtu.be", `https://youtu.be/${id}?si=abc`],
    ["m.youtube.com", `https://m.youtube.com/watch?v=${id}`],
    ["a live stream", `https://www.youtube.com/live/${id}?feature=share`],
    [
      "a video inside a playlist",
      `https://www.youtube.com/watch?v=${id}&list=${Fixtures.playlistId}`,
    ],
  ])("reads %s as a video", (_, url) => {
    expect(FetchYoutubeContent.target(url)).toEqual(Option.some(video));
  });

  it("reads a playlist page as a playlist", () => {
    expect(
      FetchYoutubeContent.target(`https://www.youtube.com/playlist?list=${Fixtures.playlistId}`),
    ).toEqual(Option.some(playlist));
  });

  it.each([
    "https://www.youtube.com/@synthetic-channel",
    "https://example.com/watch?v=aaaaaaaaaaa",
  ])("leaves %s to the page fetcher", (url) => {
    expect(FetchYoutubeContent.target(url)).toEqual(Option.none());
  });

  it("asks oEmbed about the plain watch or playlist URL", () => {
    expect(FetchYoutubeContent.pageUrl(video)).toBe(`https://www.youtube.com/watch?v=${id}`);
    expect(FetchYoutubeContent.pageUrl(playlist)).toBe(
      `https://www.youtube.com/playlist?list=${Fixtures.playlistId}`,
    );
  });
});

describe("FetchYoutubeContent.fetchYoutubeContent", () => {
  it.effect("takes the title and channel from oEmbed when the watch page is a consent page", () =>
    Effect.gen(function* () {
      const content = yield* FetchYoutubeContent.fetchYoutubeContent(video);
      expect(content).toEqual({
        title: Option.some("A Synthetic Video, Told by oEmbed"),
        description: Option.none(),
        author: Option.some("Synthetic Channel"),
        imageUrl: Option.some(thumbnail),
        language: Option.none(),
        text: "",
        source: "metadata",
      });
      const requests = yield* FakeHttp.FakeHttp.use((http) => http.requests);
      expect(requests.map((request) => request.url)).toEqual([oembed, watch]);
    }).pipe(
      Effect.provide(
        FakeHttp.layer({
          [oembed]: { body: Fixtures.oembedVideo, contentType: json },
          [watch]: { body: Fixtures.consentPage },
        }),
      ),
    ),
  );

  it.effect("adds the transcript when the watch page works, keeping oEmbed's title", () =>
    Effect.gen(function* () {
      const content = yield* FetchYoutubeContent.fetchYoutubeContent(video);
      expect(content).toMatchObject({
        title: Option.some("A Synthetic Video, Told by oEmbed"),
        author: Option.some("Synthetic Channel"),
        imageUrl: Option.some(thumbnail),
        language: Option.some("en"),
        source: "transcript",
      });
      expect(content.text).toContain("Hello and welcome");
    }).pipe(
      Effect.provide(
        FakeHttp.layer({
          [oembed]: { body: Fixtures.oembedVideo, contentType: json },
          [watch]: { body: Fixtures.watchPage(Fixtures.tracks) },
          [enTrack!.baseUrl]: { body: Fixtures.timedTextV1, contentType: "text/xml" },
        }),
      ),
    ),
  );

  it.effect("falls back to the watch page's title when oEmbed has no answer", () =>
    Effect.gen(function* () {
      const content = yield* FetchYoutubeContent.fetchYoutubeContent(video);
      expect(content.title).toEqual(Option.some("A Synthetic Video {with braces}"));
      expect(content.author).toEqual(Option.none());
      expect(content.source).toBe("description");
      expect(content.imageUrl).toEqual(Option.some(thumbnail));
    }).pipe(
      Effect.provide(
        FakeHttp.layer({ [oembed]: { status: 401 }, [watch]: { body: Fixtures.watchPage() } }),
      ),
    ),
  );

  it.effect("keeps the thumbnail and nothing else when both sources have no answer", () =>
    Effect.gen(function* () {
      const content = yield* FetchYoutubeContent.fetchYoutubeContent(video);
      expect(content).toEqual({
        title: Option.none(),
        description: Option.none(),
        author: Option.none(),
        imageUrl: Option.some(thumbnail),
        language: Option.none(),
        text: "",
        source: "metadata",
      });
    }).pipe(
      Effect.provide(
        FakeHttp.layer({ [oembed]: { status: 404 }, [watch]: { body: Fixtures.botCheckPage } }),
      ),
    ),
  );

  it.effect("does not fail when the watch page keeps failing", () =>
    Effect.gen(function* () {
      const content = yield* FetchYoutubeContent.fetchYoutubeContent(video).pipe(
        EnrichmentTestLayer.noDelays,
      );
      expect(content.title).toEqual(Option.some("A Synthetic Video, Told by oEmbed"));
      expect(content.source).toBe("metadata");
    }).pipe(
      Effect.provide(
        FakeHttp.layer({
          [oembed]: { body: Fixtures.oembedVideo, contentType: json },
          [watch]: { status: 429 },
        }),
      ),
    ),
  );

  it.effect("fails when oEmbed keeps failing transiently, so the link is tried again", () =>
    Effect.gen(function* () {
      const error = yield* FetchYoutubeContent.fetchYoutubeContent(video).pipe(
        EnrichmentTestLayer.noDelays,
        Effect.flip,
      );
      expect(error.isTransient).toBe(true);
    }).pipe(Effect.provide(FakeHttp.layer({ [oembed]: { status: 503 } }))),
  );

  it.effect("reads a playlist from oEmbed alone", () =>
    Effect.gen(function* () {
      const content = yield* FetchYoutubeContent.fetchYoutubeContent(playlist);
      expect(content).toEqual({
        title: Option.some("A Synthetic Playlist"),
        description: Option.none(),
        author: Option.some("Synthetic Channel"),
        imageUrl: Option.some("https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg"),
        language: Option.none(),
        text: "",
        source: "metadata",
      });
      const requests = yield* FakeHttp.FakeHttp.use((http) => http.requests);
      expect(requests.map((request) => request.url)).toEqual([playlistOembed]);
    }).pipe(
      Effect.provide(
        FakeHttp.layer({ [playlistOembed]: { body: Fixtures.oembedPlaylist, contentType: json } }),
      ),
    ),
  );
});
