import * as AnthropicClient from "@effect/ai-anthropic/AnthropicClient";
import * as AnthropicLanguageModel from "@effect/ai-anthropic/AnthropicLanguageModel";
import * as AnthropicConfig from "@stash/backend-platform/anthropic-config";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as AiError from "effect/ai/AiError";
import * as LanguageModel from "effect/ai/LanguageModel";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ContentText from "./content-text.ts";
import * as DetectLanguage from "./detect-language.ts";
import * as EnrichPolicy from "./enrich-policy.ts";

/** The classifier model: small and fast, good at Russian and English. */
export const model = "claude-haiku-5-5";

/** At most this many tags are kept. */
export const maxTags = 8;

/** Longer texts are cut to this many characters before they reach the model. */
export const maxPromptTextLength = 12_000;

/**
 * The structured output the model fills. It stays loose (plain strings) so the provider's JSON
 * schema has no constraints it might not support. `classifyLink` normalizes it.
 */
export const ClassificationOutput = Schema.Struct({
  tags: Schema.Array(Schema.String).annotate({
    description: "3 to 6 topic tags: lowercase English, 1 to 3 words each, most specific first",
  }),
  summary: Schema.String.annotate({
    description: "1 to 3 sentences on what the link is about, in the content's language",
  }),
  type: Link.LinkType.annotate({ description: "What kind of resource the link is" }),
  language: Schema.String.annotate({
    description: "ISO 639-1 code of the content's main language, such as en or ru",
  }),
});
export type ClassificationOutput = typeof ClassificationOutput.Type;

/** A link's classification, ready to store. */
export interface Classification {
  readonly tags: ReadonlyArray<Tag.TagName>;
  readonly summary: string;
  readonly type: Link.LinkType;
  /** An ISO 639-1 code, when the model gave a plausible one. */
  readonly language: Option.Option<string>;
}

/** What the classifier reads about a link. */
export interface ClassifyInput {
  readonly url: string;
  readonly title: Option.Option<string>;
  readonly content: Option.Option<ContentText.ContentText>;
}

/**
 * Classification failed. `permanent` failures are about this link's content (a content policy
 * refusal, a rejected request, output that never matched the schema), so retrying will not help.
 * Anything else (rate limits, outages, a missing or invalid key) is worth another delivery.
 */
export class ClassifyError extends Data.TaggedError("ClassifyError")<{
  readonly permanent: boolean;
  readonly cause: AiError.AiError;
}> {}

const permanentReasons: ReadonlySet<string> = new Set([
  "ContentPolicyError",
  "InvalidRequestError",
  "InvalidOutputError",
  "StructuredOutputError",
  "UnsupportedSchemaError",
]);

export const system = `You classify links saved to a personal reading list. The content is usually in
Russian or English, sometimes mixed.

Reply with:
- tags: 3 to 6 topic tags, lowercase, in English even when the content is in Russian, 1 to 3 words
  each, most specific first. Prefer established names (typescript, machine learning, economics) over
  invented ones. No tags for the type (article, video) or the language.
- summary: 1 to 3 plain sentences on what the link is about and why it may be worth reading. Write it
  in the content's main language: Russian content gets a Russian summary, English content an
  English one. No preamble such as "This article".
- type: video for videos and talks, repo for source repositories, tool for apps, services and
  libraries' home pages, article for posts, docs and papers, other for anything else.
- language: the ISO 639-1 code of the content's main language (en, ru, …).

If the text is missing or is only a cookie banner or an error page, classify from the URL and title.`;

/** The user message: what is known about the link, with the text cut to `maxPromptTextLength`. */
export const userMessage = (input: ClassifyInput): string => {
  const lines = [`URL: ${input.url}`];
  const title = input.title.pipe(
    Option.orElse(() => Option.flatMap(input.content, (content) => content.title)),
  );
  if (Option.isSome(title)) lines.push(`Title: ${title.value}`);
  if (Option.isSome(input.content)) {
    const content = input.content.value;
    if (Option.isSome(content.description)) lines.push(`Description: ${content.description.value}`);
    if (Option.isSome(content.language)) lines.push(`Detected language: ${content.language.value}`);
    lines.push(`Source: ${content.source}`);
    const text = ContentText.truncate(content.text, maxPromptTextLength);
    lines.push("", "Text:", text === "" ? "(empty)" : text);
  } else {
    lines.push("", "Text: (could not be fetched)");
  }
  return lines.join("\n");
};

const decodeTag = Schema.decodeUnknownOption(Tag.TagName);

/** Lowercased, trimmed, valid and unique tags, at most `maxTags`. */
export const normalizeTags = (tags: ReadonlyArray<string>): ReadonlyArray<Tag.TagName> => {
  const seen = new Set<string>();
  const result: Array<Tag.TagName> = [];
  for (const raw of tags) {
    const tag = decodeTag(raw.trim().toLowerCase().replace(/\s+/g, " "));
    if (Option.isNone(tag) || seen.has(tag.value)) continue;
    seen.add(tag.value);
    result.push(tag.value);
    if (result.length === maxTags) break;
  }
  return result;
};

export const normalize = (output: ClassificationOutput): Classification => ({
  tags: normalizeTags(output.tags),
  summary: output.summary.trim(),
  type: output.type,
  language: DetectLanguage.normalizeTag(output.language),
});

/**
 * Asks the language model for a link's tags, summary, type and language. Retryable model errors
 * are retried on the `EnrichPolicy` schedule before they fail.
 */
export const classifyLink = (
  input: ClassifyInput,
): Effect.Effect<Classification, ClassifyError, LanguageModel.LanguageModel> =>
  Effect.gen(function* () {
    const policy = yield* EnrichPolicy.EnrichPolicy;
    const response = yield* LanguageModel.generateObject({
      objectName: "link_classification",
      prompt: [
        { role: "system", content: system },
        { role: "user", content: userMessage(input) },
      ],
      schema: ClassificationOutput,
    }).pipe(
      Effect.retry({
        schedule: policy.retrySchedule,
        times: policy.retries,
        while: (error) => error.isRetryable,
      }),
      Effect.mapError(
        (cause) => new ClassifyError({ permanent: permanentReasons.has(cause.reason._tag), cause }),
      ),
    );
    return normalize(response.value);
  }).pipe(Effect.withSpan("classifyLink"));

/** Anthropic as the `LanguageModel`, with the key from `AnthropicConfig`. */
export const layerAnthropic: Layer.Layer<
  LanguageModel.LanguageModel,
  never,
  AnthropicConfig.AnthropicConfig | HttpClient.HttpClient
> = AnthropicLanguageModel.layer({
  model,
  // The provider does not know this model id yet, so native structured outputs are switched on
  // explicitly.
  config: { max_tokens: 1024, structuredOutputs: true },
}).pipe(
  Layer.provide(
    Layer.unwrap(
      Effect.gen(function* () {
        const { apiKey } = yield* AnthropicConfig.AnthropicConfig;
        return AnthropicClient.layer({ apiKey });
      }),
    ),
  ),
);

/**
 * A `LanguageModel` for a Worker deployed without `ANTHROPIC_API_KEY`: every call fails with a
 * missing-key error, which is not permanent, so messages are retried once the key is set.
 */
export const layerMissingKey: Layer.Layer<LanguageModel.LanguageModel> = Layer.effect(
  LanguageModel.LanguageModel,
)(
  LanguageModel.make({
    generateText: () =>
      Effect.fail(
        AiError.make({
          module: "ClassifyLink",
          method: "generateText",
          reason: new AiError.AuthenticationError({
            kind: "MissingKey",
            description: "ANTHROPIC_API_KEY is not configured",
          }),
        }),
      ),
    streamText: () => Effect.die(new Error("streamText is not used by the classifier")) as never,
  }),
);
