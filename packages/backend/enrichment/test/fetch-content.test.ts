import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FetchContent from "../src/fetch-content.ts";
import * as FetchYoutubeTranscript from "../src/fetch-youtube-transcript.ts";
import * as FakeHttp from "./fake-http.ts";
import * as Fixtures from "./fixtures.ts";

const layer = FakeHttp.layer({
  "https://example.com/article": { body: Fixtures.articlePage },
  [FetchYoutubeTranscript.watchUrl(Fixtures.videoId)]: { body: Fixtures.watchPage() },
});

describe("FetchContent.fetchContent", () => {
  it.effect("fetches page text for a web page", () =>
    Effect.gen(function* () {
      const content = yield* FetchContent.fetchContent("https://example.com/article");
      expect(content.source).toBe("page");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fetches the transcript for a YouTube video", () =>
    Effect.gen(function* () {
      const content = yield* FetchContent.fetchContent(`https://youtu.be/${Fixtures.videoId}`);
      expect(content.source).toBe("description");
      const requests = yield* FakeHttp.FakeHttp.use((http) => http.requests);
      expect(requests.map((request) => request.url)).toEqual([
        FetchYoutubeTranscript.watchUrl(Fixtures.videoId),
      ]);
    }).pipe(Effect.provide(layer)),
  );
});
