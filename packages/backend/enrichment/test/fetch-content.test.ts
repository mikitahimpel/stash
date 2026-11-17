import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FetchContent from "../src/fetch-content.ts";
import * as FetchYoutubeOembed from "../src/fetch-youtube-oembed.ts";
import * as FetchYoutubeTranscript from "../src/fetch-youtube-transcript.ts";
import * as FakeHttp from "./fake-http.ts";
import * as Fixtures from "./fixtures.ts";

const oembed = FetchYoutubeOembed.oembedUrl(`https://www.youtube.com/watch?v=${Fixtures.videoId}`);
const playlistOembed = FetchYoutubeOembed.oembedUrl(
  `https://www.youtube.com/playlist?list=${Fixtures.playlistId}`,
);

const layer = FakeHttp.layer({
  "https://example.com/article": { body: Fixtures.articlePage },
  [oembed]: { body: Fixtures.oembedVideo, contentType: "application/json" },
  [playlistOembed]: { body: Fixtures.oembedPlaylist, contentType: "application/json" },
  [FetchYoutubeTranscript.watchUrl(Fixtures.videoId)]: { body: Fixtures.watchPage() },
});

describe("FetchContent.fetchContent", () => {
  it.effect("fetches page text for a web page", () =>
    Effect.gen(function* () {
      const content = yield* FetchContent.fetchContent("https://example.com/article");
      expect(content.source).toBe("page");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("asks oEmbed, then the watch page, for a YouTube video", () =>
    Effect.gen(function* () {
      const content = yield* FetchContent.fetchContent(`https://youtu.be/${Fixtures.videoId}`);
      expect(content.source).toBe("description");
      const requests = yield* FakeHttp.FakeHttp.use((http) => http.requests);
      expect(requests.map((request) => request.url)).toEqual([
        oembed,
        FetchYoutubeTranscript.watchUrl(Fixtures.videoId),
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("asks oEmbed alone for a YouTube playlist", () =>
    Effect.gen(function* () {
      const content = yield* FetchContent.fetchContent(
        `https://m.youtube.com/playlist?list=${Fixtures.playlistId}`,
      );
      expect(content.source).toBe("metadata");
      const requests = yield* FakeHttp.FakeHttp.use((http) => http.requests);
      expect(requests.map((request) => request.url)).toEqual([playlistOembed]);
    }).pipe(Effect.provide(layer)),
  );
});
