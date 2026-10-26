import * as AiError from "effect/ai/AiError";
import * as LanguageModel from "effect/ai/LanguageModel";
import type * as Prompt from "effect/ai/Prompt";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type * as ClassifyLink from "../src/classify-link.ts";

// A scripted `LanguageModel`. No request leaves the process: each call answers with the next reply
// (the last one repeats), either a classification as JSON text or an `AiError` reason.

export type Reply = ClassifyLink.ClassificationOutput | AiError.AiErrorReason;

export class FakeLanguageModel extends Context.Service<
  FakeLanguageModel,
  { readonly prompts: Effect.Effect<ReadonlyArray<Prompt.Prompt>> }
>()("@stash/backend-enrichment/test/FakeLanguageModel") {}

const isReason = (reply: Reply): reply is AiError.AiErrorReason => "_tag" in reply;

export const layer = (
  ...replies: ReadonlyArray<Reply>
): Layer.Layer<LanguageModel.LanguageModel | FakeLanguageModel> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const prompts: Array<Prompt.Prompt> = [];
      const model = yield* LanguageModel.make({
        generateText: (options) =>
          Effect.suspend(() => {
            const reply = replies[Math.min(prompts.length, replies.length - 1)];
            prompts.push(options.prompt);
            if (reply === undefined) return Effect.die(new Error("no scripted reply"));
            if (isReason(reply)) {
              return Effect.fail(
                AiError.make({
                  module: "FakeLanguageModel",
                  method: "generateText",
                  reason: reply,
                }),
              );
            }
            return Effect.succeed([
              { type: "text" as const, text: JSON.stringify(reply) },
              {
                type: "finish" as const,
                reason: "stop" as const,
                usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
              },
            ]);
          }),
        streamText: () => Stream.die(new Error("streamText is not scripted")),
      });
      return Context.make(LanguageModel.LanguageModel, model).pipe(
        Context.add(FakeLanguageModel, { prompts: Effect.sync(() => [...prompts]) }),
      );
    }),
  );

/** Every message text of a prompt, joined. */
export const promptText = (prompt: Prompt.Prompt): string =>
  prompt.content
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => ("text" in part ? part.text : "")).join(""),
    )
    .join("\n");
