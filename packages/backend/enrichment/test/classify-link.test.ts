import { describe, expect, it } from "@effect/vitest";
import * as AiError from "effect/ai/AiError";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as ClassifyLink from "../src/classify-link.ts";
import * as EnrichPolicy from "../src/enrich-policy.ts";
import * as FakeLanguageModel from "./fake-language-model.ts";

const noDelays = Effect.provideService(EnrichPolicy.EnrichPolicy, {
  retrySchedule: Schedule.forever,
  retries: 2,
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

  it.effect("drops a meta-summary and placeholder tags even if the model writes them", () =>
    Effect.gen(function* () {
      const result = yield* ClassifyLink.classifyLink(video);
      expect(result.summary).toEqual(Option.none());
      expect(result.tags).toEqual(["youtube"]);
    }).pipe(Effect.provide(FakeLanguageModel.layer(junkReply))),
  );

  it.effect("drops a meta-summary of a text that is only a consent page", () =>
    Effect.gen(function* () {
      const result = yield* ClassifyLink.classifyLink({
        ...russian,
        content: Option.map(russian.content, (content) => ({
          ...content,
          text: "Before you continue. We use cookies and data.",
        })),
      });
      expect(result.summary).toEqual(Option.none());
      expect(result.tags).toEqual(["youtube"]);
    }).pipe(Effect.provide(FakeLanguageModel.layer(junkReply))),
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
