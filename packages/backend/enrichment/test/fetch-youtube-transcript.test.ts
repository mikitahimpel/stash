import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FetchYoutubeTranscript from "../src/fetch-youtube-transcript.ts";
import * as FakeHttp from "./fake-http.ts";
import * as Fixtures from "./fixtures.ts";

const id = Fixtures.videoId;
const watch = FetchYoutubeTranscript.watchUrl(id);
const [deTrack, asrTrack, enTrack] = Fixtures.tracks;

describe("FetchYoutubeTranscript.videoId", () => {
  it.each([
    `https://www.youtube.com/watch?v=${id}&t=42s`,
    `https://youtube.com/watch?list=x&v=${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ])("finds the id in %s", (url) => {
    expect(FetchYoutubeTranscript.videoId(url)).toEqual(Option.some(id));
  });

  it.each([
    "https://example.com/watch?v=AbCdEfGhIjK",
    "https://www.youtube.com/channel/UCabcdefghijklmnop",
    "https://www.youtube.com/watch?v=short",
    "https://youtu.be/",
    "not a url",
  ])("rejects %s", (url) => {
    expect(FetchYoutubeTranscript.videoId(url)).toEqual(Option.none());
  });
});

describe("FetchYoutubeTranscript helpers", () => {
  it("extracts a JSON object with braces inside strings", () => {
    expect(
      FetchYoutubeTranscript.extractJsonObject('x = {"a": "}{\\"", "b": {"c": 1}}; y', "x ="),
    ).toEqual(Option.some({ a: '}{"', b: { c: 1 } }));
    expect(FetchYoutubeTranscript.extractJsonObject("x = {broken", "x =")).toEqual(Option.none());
    expect(FetchYoutubeTranscript.extractJsonObject("nothing here", "x =")).toEqual(Option.none());
  });

  it("prefers a manual track in the video's language", () => {
    expect(FetchYoutubeTranscript.pickTrack(Fixtures.tracks, Option.some("en"))).toEqual(
      Option.some(enTrack),
    );
    expect(FetchYoutubeTranscript.pickTrack([asrTrack!, deTrack!], Option.some("en"))).toEqual(
      Option.some(deTrack),
    );
    expect(FetchYoutubeTranscript.pickTrack([], Option.some("en"))).toEqual(Option.none());
  });

  it("parses both timedtext formats", () => {
    expect(FetchYoutubeTranscript.parseTimedText(Fixtures.timedTextV1)).toBe(
      "Hello and welcome to this video.\nToday we'll talk about parsers & text.",
    );
    expect(FetchYoutubeTranscript.parseTimedText(Fixtures.timedTextV3)).toBe(
      "Hello there\nSecond cue",
    );
  });
});

describe("FetchYoutubeTranscript.fetchYoutubeTranscript", () => {
  it.effect("returns the transcript of the best caption track", () =>
    Effect.gen(function* () {
      const content = yield* FetchYoutubeTranscript.fetchYoutubeTranscript(id);
      expect(content).toEqual({
        title: Option.some("A Synthetic Video {with braces}"),
        description: Option.some('Description of the video, with "quotes" and } braces.'),
        language: Option.some("en"),
        text: "Hello and welcome to this video.\nToday we'll talk about parsers & text.",
        source: "transcript",
      });
      const requests = yield* FakeHttp.FakeHttp.use((http) => http.requests);
      expect(requests.map((request) => request.url)).toEqual([watch, enTrack!.baseUrl]);
    }).pipe(
      Effect.provide(
        FakeHttp.layer({
          [watch]: { body: Fixtures.watchPage(Fixtures.tracks) },
          [enTrack!.baseUrl]: { body: Fixtures.timedTextV1, contentType: "text/xml" },
        }),
      ),
    ),
  );

  it.effect("falls back to the description when there are no captions", () =>
    Effect.gen(function* () {
      const content = yield* FetchYoutubeTranscript.fetchYoutubeTranscript(id);
      expect(content.source).toBe("description");
      expect(content.text).toBe('Description of the video, with "quotes" and } braces.');
      expect(content.language).toEqual(Option.some("en"));
    }).pipe(Effect.provide(FakeHttp.layer({ [watch]: { body: Fixtures.watchPage() } }))),
  );

  it.effect("falls back to the description when the caption fetch fails", () =>
    Effect.gen(function* () {
      const content = yield* FetchYoutubeTranscript.fetchYoutubeTranscript(id);
      expect(content.source).toBe("description");
      expect(content.title).toEqual(Option.some("A Synthetic Video {with braces}"));
    }).pipe(
      Effect.provide(
        FakeHttp.layer({
          [watch]: { body: Fixtures.watchPage(Fixtures.tracks) },
          [enTrack!.baseUrl]: { status: 403 },
        }),
      ),
    ),
  );

  it.effect("falls back to the description when the transcript is empty", () =>
    Effect.gen(function* () {
      const content = yield* FetchYoutubeTranscript.fetchYoutubeTranscript(id);
      expect(content.source).toBe("description");
    }).pipe(
      Effect.provide(
        FakeHttp.layer({
          [watch]: { body: Fixtures.watchPage([enTrack!]) },
          [enTrack!.baseUrl]: { body: "<transcript></transcript>", contentType: "text/xml" },
        }),
      ),
    ),
  );

  it.effect("keeps the page title when the player response is missing", () =>
    Effect.gen(function* () {
      const content = yield* FetchYoutubeTranscript.fetchYoutubeTranscript(id);
      expect(content).toEqual({
        title: Option.some("Consent - YouTube"),
        description: Option.none(),
        language: Option.none(),
        text: "",
        source: "description",
      });
    }).pipe(
      Effect.provide(
        FakeHttp.layer({ [watch]: { body: "<html><title>Consent - YouTube</title></html>" } }),
      ),
    ),
  );

  it.effect("fails when the watch page fails", () =>
    Effect.gen(function* () {
      const error = yield* FetchYoutubeTranscript.fetchYoutubeTranscript(id).pipe(Effect.flip);
      expect(error.reason).toBe("Status");
      expect(error.status).toBe(404);
    }).pipe(Effect.provide(FakeHttp.layer({ [watch]: { status: 404 } }))),
  );
});
