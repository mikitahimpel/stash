import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FetchYoutubeOembed from "../src/fetch-youtube-oembed.ts";
import * as EnrichmentTestLayer from "./enrichment-test-layer.ts";
import * as FakeHttp from "./fake-http.ts";
import * as Fixtures from "./fixtures.ts";

const page = `https://www.youtube.com/watch?v=${Fixtures.videoId}`;
const oembed = FetchYoutubeOembed.oembedUrl(page);
const json = "application/json";

describe("FetchYoutubeOembed", () => {
  it("asks the keyless endpoint for JSON about the page", () => {
    expect(oembed).toBe(
      `https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${Fixtures.videoId}&format=json`,
    );
  });

  it("parses a response, and nothing else", () => {
    expect(FetchYoutubeOembed.parseOembed(Fixtures.oembedVideo)).toEqual(
      Option.some({
        title: Option.some("A Synthetic Video, Told by oEmbed"),
        authorName: Option.some("Synthetic Channel"),
        thumbnailUrl: Option.some(`https://i.ytimg.com/vi/${Fixtures.videoId}/hqdefault.jpg`),
      }),
    );
    expect(FetchYoutubeOembed.parseOembed('{"title": "  "}')).toEqual(
      Option.some({
        title: Option.none(),
        authorName: Option.none(),
        thumbnailUrl: Option.none(),
      }),
    );
    expect(FetchYoutubeOembed.parseOembed("Not Found")).toEqual(Option.none());
    expect(FetchYoutubeOembed.parseOembed('{"title": 42}')).toEqual(Option.none());
  });

  it.effect("fetches title, channel and thumbnail", () =>
    Effect.gen(function* () {
      const result = yield* FetchYoutubeOembed.fetchYoutubeOembed(page);
      expect(Option.getOrThrow(result).title).toEqual(
        Option.some("A Synthetic Video, Told by oEmbed"),
      );
      const requests = yield* FakeHttp.FakeHttp.use((http) => http.requests);
      expect(requests.map((request) => request.url)).toEqual([oembed]);
    }).pipe(
      Effect.provide(
        FakeHttp.layer({ [oembed]: { body: Fixtures.oembedVideo, contentType: json } }),
      ),
    ),
  );

  it.effect.each([401, 403, 404])("has no answer for a %i (private or deleted)", (status) =>
    Effect.gen(function* () {
      expect(yield* FetchYoutubeOembed.fetchYoutubeOembed(page)).toEqual(Option.none());
    }).pipe(Effect.provide(FakeHttp.layer({ [oembed]: { status, body: "Unauthorized" } }))),
  );

  it.effect("has no answer when the body is not oEmbed JSON", () =>
    Effect.gen(function* () {
      expect(yield* FetchYoutubeOembed.fetchYoutubeOembed(page)).toEqual(Option.none());
    }).pipe(Effect.provide(FakeHttp.layer({ [oembed]: { body: Fixtures.consentPage } }))),
  );

  it.effect("retries a rate limit, then fails as transient", () =>
    Effect.gen(function* () {
      const error = yield* FetchYoutubeOembed.fetchYoutubeOembed(page).pipe(
        EnrichmentTestLayer.noDelays,
        Effect.flip,
      );
      expect(error.isTransient).toBe(true);
      const requests = yield* FakeHttp.FakeHttp.use((http) => http.requests);
      expect(requests).toHaveLength(3);
    }).pipe(Effect.provide(FakeHttp.layer({ [oembed]: { status: 429 } }))),
  );
});
