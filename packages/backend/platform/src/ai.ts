import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

/** Multilingual (Russian + English) embedding model on Workers AI. */
export const embeddingModel = "@cf/baai/bge-m3";

/** Length of every `embeddingModel` vector. The Vectorize index is created with it. */
export const embeddingDimensions = 1024;

export type Embedding = ReadonlyArray<number>;

export class AiError extends Data.TaggedError("AiError")<{
  readonly model: string;
  readonly cause: unknown;
}> {}

/** The part of the Workers AI binding this package uses. `Ai` satisfies it. */
export interface AiBinding {
  run(model: typeof embeddingModel, inputs: { text: Array<string> }): Promise<unknown>;
}

/** Workers AI. */
export class Ai extends Context.Service<
  Ai,
  {
    /** One embedding per text, in order. */
    readonly embed: (
      texts: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<Embedding>, AiError>;
  }
>()("@stash/backend-platform/Ai") {}

const EmbeddingOutput = Schema.Struct({ data: Schema.Array(Schema.Array(Schema.Number)) });

/** Wraps a Workers AI binding. */
export const make = (ai: AiBinding): Ai["Service"] => ({
  embed: (texts) =>
    texts.length === 0
      ? Effect.succeed([])
      : Effect.tryPromise({
          try: () => ai.run(embeddingModel, { text: [...texts] }),
          catch: (cause) => new AiError({ model: embeddingModel, cause }),
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(EmbeddingOutput)),
          Effect.mapError((cause) =>
            cause instanceof AiError ? cause : new AiError({ model: embeddingModel, cause }),
          ),
          Effect.filterOrFail(
            ({ data }) => data.length === texts.length,
            ({ data }) =>
              new AiError({
                model: embeddingModel,
                cause: `expected ${texts.length} embeddings, got ${data.length}`,
              }),
          ),
          Effect.map(({ data }) => data),
        ),
});

export const layer = (ai: AiBinding): Layer.Layer<Ai> => Layer.succeed(Ai)(make(ai));
