import * as Ai from "@stash/backend-platform/ai";
import * as Testing from "@stash/backend-platform/testing";
import * as Vectors from "@stash/backend-platform/vectors";
import * as Link from "@stash/contracts-domain/link";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as EmbedLink from "../src/embed-link.ts";
import * as EnrichPolicy from "../src/enrich-policy.ts";

const id = Link.LinkId.make("link-1");

const input: EmbedLink.EmbedInput = {
  title: Option.some("Как работает инфляция"),
  summary: "Объяснение инфляции.",
  tags: ["economics", "inflation"],
  text: "Инфляция — это рост цен. ".repeat(1_000),
};

describe("embedLink", () => {
  it("puts title, summary and tags first and cuts the text", () => {
    const text = EmbedLink.embeddingText(input);
    expect(
      text.startsWith("Как работает инфляция\n\nОбъяснение инфляции.\n\neconomics, inflation"),
    ).toBe(true);
    expect(text.length).toBeLessThanOrEqual(EmbedLink.maxEmbeddingTextLength);
  });

  it.effect("upserts the embedding under the link id", () =>
    Effect.gen(function* () {
      yield* EmbedLink.embedLink(id, input);
      yield* EmbedLink.embedLink(id, input);
      const matches = yield* Vectors.Vectors.use((vectors) =>
        vectors.query(Testing.fakeEmbedding(EmbedLink.embeddingText(input))),
      );
      expect(matches).toEqual([{ id, score: expect.closeTo(1, 6), metadata: {} }]);
    }).pipe(Effect.provide(Layer.mergeAll(Testing.layerAi(), Testing.layerVectors))),
  );

  it.effect("retries Workers AI on the policy schedule", () => {
    let calls = 0;
    const flaky = Layer.succeed(Ai.Ai)({
      embed: (texts) =>
        ++calls < 3
          ? Effect.fail(new Ai.AiError({ model: Ai.embeddingModel, cause: "busy" }))
          : Effect.succeed(texts.map((text) => Testing.fakeEmbedding(text))),
    });
    return Effect.gen(function* () {
      yield* EmbedLink.embedLink(id, input).pipe(
        Effect.provideService(EnrichPolicy.EnrichPolicy, {
          retrySchedule: Schedule.forever,
          retries: 2,
        }),
      );
      expect(calls).toBe(3);
    }).pipe(Effect.provide(Layer.mergeAll(flaky, Testing.layerVectors)));
  });
});
