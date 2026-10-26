import * as Ai from "@stash/backend-platform/ai";
import * as Vectors from "@stash/backend-platform/vectors";
import type * as Link from "@stash/contracts-domain/link";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ContentText from "./content-text.ts";
import * as EnrichPolicy from "./enrich-policy.ts";

/** Longer embedding inputs are cut to this many characters (bge-m3 reads about 8k tokens). */
export const maxEmbeddingTextLength = 4_000;

/** What a link's vector embeds. */
export interface EmbedInput {
  readonly title: Option.Option<string>;
  readonly summary: string;
  readonly tags: ReadonlyArray<string>;
  readonly text: string;
}

/** Title, summary and tags first, so they survive the cut, then the start of the text. */
export const embeddingText = (input: EmbedInput): string =>
  ContentText.truncate(
    [Option.getOrElse(input.title, () => ""), input.summary, input.tags.join(", "), input.text]
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join("\n\n"),
    maxEmbeddingTextLength,
  );

/**
 * Embeds a link with Workers AI (`@cf/baai/bge-m3`) and upserts the vector into Vectorize under the
 * link id, replacing any earlier one. Both calls are retried on the `EnrichPolicy` schedule.
 */
export const embedLink = (
  id: Link.LinkId,
  input: EmbedInput,
): Effect.Effect<void, Ai.AiError | Vectors.VectorsError, Ai.Ai | Vectors.Vectors> =>
  Effect.gen(function* () {
    const policy = yield* EnrichPolicy.EnrichPolicy;
    const retry = { schedule: policy.retrySchedule, times: policy.retries };
    const [values] = yield* Effect.retry(
      Ai.Ai.use((ai) => ai.embed([embeddingText(input)])),
      retry,
    );
    if (values === undefined) {
      return yield* new Ai.AiError({ model: Ai.embeddingModel, cause: "no embedding returned" });
    }
    yield* Effect.retry(
      Vectors.Vectors.use((vectors) => vectors.upsert([{ id, values }])),
      retry,
    );
  }).pipe(Effect.withSpan("embedLink"));
