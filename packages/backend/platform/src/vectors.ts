import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type MetadataValue = string | number | boolean;
export type Metadata = Readonly<Record<string, MetadataValue>>;

export interface Vector {
  readonly id: string;
  readonly values: ReadonlyArray<number>;
  readonly metadata?: Metadata;
}

export interface Match {
  readonly id: string;
  /** Cosine similarity: higher is closer. */
  readonly score: number;
  readonly metadata: Metadata;
}

export interface QueryOptions {
  /** How many matches to return. Defaults to 10. */
  readonly topK?: number;
  /** Only vectors whose metadata equals every listed field. */
  readonly filter?: Metadata;
}

export class VectorsError extends Data.TaggedError("VectorsError")<{
  readonly operation: "upsert" | "query" | "delete";
  readonly cause: unknown;
}> {}

/** The part of the Vectorize binding this package uses. `Vectorize` satisfies it. */
export interface VectorizeBinding {
  upsert(
    vectors: Array<{ id: string; values: Array<number>; metadata?: Record<string, MetadataValue> }>,
  ): Promise<unknown>;
  query(
    vector: Array<number>,
    options: { topK: number; returnMetadata: "all"; filter?: Record<string, MetadataValue> },
  ): Promise<{
    matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>;
  }>;
  deleteByIds(ids: Array<string>): Promise<unknown>;
}

/** The Vectorize index of link embeddings, keyed by link id. */
export class Vectors extends Context.Service<
  Vectors,
  {
    readonly upsert: (vectors: ReadonlyArray<Vector>) => Effect.Effect<void, VectorsError>;
    readonly query: (
      vector: ReadonlyArray<number>,
      options?: QueryOptions,
    ) => Effect.Effect<ReadonlyArray<Match>, VectorsError>;
    readonly deleteByIds: (ids: ReadonlyArray<string>) => Effect.Effect<void, VectorsError>;
  }
>()("@stash/backend-platform/Vectors") {}

const isMetadataValue = (value: unknown): value is MetadataValue =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const toMetadata = (raw: Record<string, unknown> | undefined): Metadata =>
  Object.fromEntries(Object.entries(raw ?? {}).filter(([, value]) => isMetadataValue(value))) as {
    [key: string]: MetadataValue;
  };

/** Wraps a Vectorize binding. */
export const make = (index: VectorizeBinding): Vectors["Service"] => {
  const call = <A>(operation: VectorsError["operation"], f: () => Promise<A>) =>
    Effect.tryPromise({ try: f, catch: (cause) => new VectorsError({ operation, cause }) });
  return {
    upsert: (vectors) =>
      vectors.length === 0
        ? Effect.void
        : call("upsert", () =>
            index.upsert(
              vectors.map(({ id, values, metadata }) => ({
                id,
                values: [...values],
                ...(metadata === undefined ? {} : { metadata: { ...metadata } }),
              })),
            ),
          ).pipe(Effect.asVoid),
    query: (vector, options = {}) =>
      call("query", () =>
        index.query([...vector], {
          topK: options.topK ?? 10,
          returnMetadata: "all",
          ...(options.filter === undefined ? {} : { filter: { ...options.filter } }),
        }),
      ).pipe(
        Effect.map(({ matches }) =>
          matches.map(({ id, score, metadata }) => ({ id, score, metadata: toMetadata(metadata) })),
        ),
      ),
    deleteByIds: (ids) =>
      ids.length === 0
        ? Effect.void
        : call("delete", () => index.deleteByIds([...ids])).pipe(Effect.asVoid),
  };
};

export const layer = (index: VectorizeBinding): Layer.Layer<Vectors> =>
  Layer.succeed(Vectors)(make(index));
