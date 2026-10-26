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

describe("classifyLink", () => {
  it.effect("asks for structured output and normalizes it", () =>
    Effect.gen(function* () {
      const result = yield* ClassifyLink.classifyLink(russian);
      expect(result).toEqual({
        tags: ["economics", "inflation", "central banks"],
        summary: "Объяснение инфляции простыми словами.",
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
      expect(FakeLanguageModel.promptText(prompt!)).toContain("Text: (could not be fetched)");
    }).pipe(Effect.provide(FakeLanguageModel.layer({ ...reply, type: "tool" }))),
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
