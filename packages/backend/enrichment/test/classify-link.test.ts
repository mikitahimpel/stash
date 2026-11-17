import { describe, expect, it } from "@effect/vitest";
import * as AiError from "effect/ai/AiError";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as ClassifyLink from "../src/classify-link.ts";
import * as EnrichPolicy from "../src/enrich-policy.ts";
import * as FakeLanguageModel from "./fake-language-model.ts";

const noDelays = Effect.provideService(EnrichPolicy.EnrichPolicy, {
  ...EnrichPolicy.defaultPolicy,
  retrySchedule: Schedule.forever,
});

const russian: ClassifyLink.ClassifyInput = {
  url: "https://example.com/ru/inflation",
  title: Option.none(),
  content: Option.some({
    title: Option.some("Как работает инфляция"),
    description: Option.none(),
    author: Option.none(),
    imageUrl: Option.none(),
    language: Option.some("ru"),
    text: "Инфляция — это рост общего уровня цен. ".repeat(1_000),
    source: "page",
  }),
};

const reply: ClassifyLink.ClassificationOutput = {
  tags: [" Economics ", "inflation", "ECONOMICS", "", "central   banks", "x".repeat(65)],
  summary: "  Объяснение инфляции простыми словами.  ",
  type: "article",
  language: "ru-RU",
};

const video: ClassifyLink.ClassifyInput = {
  url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  title: Option.some("A Synthetic Video, Told by oEmbed"),
  content: Option.some({
    title: Option.some("A Synthetic Video, Told by oEmbed"),
    description: Option.none(),
    author: Option.some("Synthetic Channel"),
    imageUrl: Option.some("https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg"),
    language: Option.none(),
    text: "",
    source: "metadata",
  }),
};

/** What the model wrote before #147 when it was given nothing. */
const junkReply: ClassifyLink.ClassificationOutput = {
  tags: ["unclassified", "Missing Title", "youtube", "unknown topic"],
  summary:
    "The page text and title were unavailable, so the topic of this YouTube video cannot be determined.",
  type: "video",
  language: "en",
};

describe("classifyLink", () => {
  it.effect("asks for structured output and normalizes it", () =>
    Effect.gen(function* () {
      const result = yield* ClassifyLink.classifyLink(russian);
      expect(result).toEqual({
        tags: ["economics", "inflation", "central banks"],
        summary: Option.some("Объяснение инфляции простыми словами."),
        type: "article",
        language: Option.some("ru"),
      });
      const [prompt] = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
      expect(prompt?.content.map((message) => message.role)).toEqual(["system", "user"]);
      const text = FakeLanguageModel.promptText(prompt!);
      expect(text).toContain("Russian content gets a Russian summary");
      expect(text).toContain("Title: Как работает инфляция");
      expect(text).toContain("Detected language: ru");
      // The text is cut before it reaches the model.
      expect(text.length).toBeLessThan(ClassifyLink.maxPromptTextLength + 3_000);
    }).pipe(Effect.provide(FakeLanguageModel.layer(reply))),
  );

  it.effect("classifies from the URL when there is no content", () =>
    Effect.gen(function* () {
      yield* ClassifyLink.classifyLink({
        url: "https://example.com/tool",
        title: Option.some("A synthetic tool"),
        content: Option.none(),
      });
      const [prompt] = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
      expect(FakeLanguageModel.promptText(prompt!)).toContain("Text: (none;");
    }).pipe(Effect.provide(FakeLanguageModel.layer({ ...reply, type: "tool" }))),
  );

  it.effect("gives the model the title and channel of a video with no text", () =>
    Effect.gen(function* () {
      const result = yield* ClassifyLink.classifyLink(video);
      const [prompt] = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
      const text = FakeLanguageModel.promptText(prompt!);
      expect(text).toContain("Title: A Synthetic Video, Told by oEmbed");
      expect(text).toContain("Channel: Synthetic Channel");
      expect(text).toContain("Text: (none;");
      expect(text).not.toContain("Source:");
      // The system prompt forbids writing about what is missing.
      expect(text).toContain("Never write about what is missing");
      // The model's tags and type count. Its summary does not: there was nothing to summarize.
      expect(result).toEqual({
        tags: ["economics", "inflation", "central banks"],
        summary: Option.none(),
        type: "video",
        language: Option.some("ru"),
      });
    }).pipe(Effect.provide(FakeLanguageModel.layer({ ...reply, type: "video" }))),
  );

  it.effect("with no text, never stores the model's prose, and drops placeholder tags", () =>
    Effect.gen(function* () {
      const result = yield* ClassifyLink.classifyLink(video);
      expect(result.summary).toEqual(Option.none());
      expect(result.tags).toEqual(["youtube"]);
    }).pipe(Effect.provide(FakeLanguageModel.layer(junkReply))),
  );

  // Real summaries that read like statements about missing content. No wording check may drop
  // them: with page text, the summary is the model's, unchanged (reviews of #150).
  it.effect.each([
    "The video explains why the root cause of the outage could not be determined.",
    "A postmortem page on an incident whose cause could not be identified.",
    "How to show a fallback page when the server is unavailable.",
    "The link between sleep and memory is missing from most models of learning.",
    "A video on why some proteins cannot be classified by structure alone.",
    "Explains why the title deed was not provided to the buyer.",
    "Covers how text search behaves when an index is missing.",
    "A talk about streaming: what to do when a video segment cannot be loaded.",
    "Why the subject of the experiment could not be identified from the data.",
    "No content is available offline unless you enable sync, the docs explain.",
    "Full details are available in the linked documentation.",
    "The text of the specification is available on GitHub.",
    "An outage report: users were unable to access their accounts for three hours.",
    "How to design pages without content layout shifts.",
    "Explains why the root cause could not be determined by the incident team.",
  ])("keeps the summary of a page with text unchanged: %s", (summary) =>
    Effect.gen(function* () {
      const result = yield* ClassifyLink.classifyLink(russian);
      expect(result.summary).toEqual(Option.some(summary));
    }).pipe(Effect.provide(FakeLanguageModel.layer({ ...reply, summary }))),
  );

  it.effect("uses the first line of the page's description when there is no text", () =>
    Effect.gen(function* () {
      const result = yield* ClassifyLink.classifyLink({
        url: "https://example.com/board",
        title: Option.some("Synthetic Board"),
        content: Option.some({
          title: Option.some("Synthetic Board"),
          description: Option.some("A kanban board for small teams.\nSecond line."),
          author: Option.none(),
          imageUrl: Option.none(),
          language: Option.none(),
          text: "",
          source: "page",
        }),
      });
      expect(result.summary).toEqual(Option.some("A kanban board for small teams."));
    }).pipe(Effect.provide(FakeLanguageModel.layer(junkReply))),
  );

  it.effect("retries retryable errors on the policy schedule", () =>
    Effect.gen(function* () {
      const result = yield* ClassifyLink.classifyLink(russian).pipe(noDelays);
      expect(result.type).toBe("article");
      const prompts = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
      expect(prompts).toHaveLength(3);
    }).pipe(
      Effect.provide(
        FakeLanguageModel.layer(
          new AiError.RateLimitError({}),
          new AiError.InternalProviderError({ description: "overloaded" }),
          reply,
        ),
      ),
    ),
  );

  it.effect("gives up after the retries, as a transient failure", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(ClassifyLink.classifyLink(russian).pipe(noDelays));
      expect(error.permanent).toBe(false);
      expect(error.cause.reason._tag).toBe("RateLimitError");
      const prompts = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
      expect(prompts).toHaveLength(3);
    }).pipe(Effect.provide(FakeLanguageModel.layer(new AiError.RateLimitError({})))),
  );

  it.effect("fails permanently on a content policy refusal, without retrying", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(ClassifyLink.classifyLink(russian).pipe(noDelays));
      expect(error.permanent).toBe(true);
      const prompts = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
      expect(prompts).toHaveLength(1);
    }).pipe(
      Effect.provide(
        FakeLanguageModel.layer(new AiError.ContentPolicyError({ description: "refused" })),
      ),
    ),
  );

  it.effect("fails permanently when the output never matches the schema", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(ClassifyLink.classifyLink(russian).pipe(noDelays));
      expect(error.permanent).toBe(true);
    }).pipe(
      Effect.provide(
        FakeLanguageModel.layer({
          ...reply,
          type: "podcast",
        } as unknown as FakeLanguageModel.Reply),
      ),
    ),
  );

  it.effect("treats a missing key as transient", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(ClassifyLink.classifyLink(russian));
      expect(error.permanent).toBe(false);
      expect(error.cause.reason._tag).toBe("AuthenticationError");
    }).pipe(Effect.provide(ClassifyLink.layerMissingKey)),
  );
});
