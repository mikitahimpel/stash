import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export interface Blob {
  readonly bytes: Uint8Array;
  readonly contentType: Option.Option<string>;
}

export interface PutOptions {
  readonly contentType?: string;
}

export class BlobsError extends Data.TaggedError("BlobsError")<{
  readonly operation: "put" | "get" | "delete";
  readonly key: string;
  readonly cause: unknown;
}> {}

/** The part of the R2 binding this package uses. `R2Bucket` satisfies it. */
export interface R2Binding {
  put(
    key: string,
    value: string | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
  delete(key: string): Promise<void>;
}

/** The R2 bucket for page text and transcripts. */
export class Blobs extends Context.Service<
  Blobs,
  {
    readonly put: (
      key: string,
      body: string | Uint8Array,
      options?: PutOptions,
    ) => Effect.Effect<void, BlobsError>;
    readonly get: (key: string) => Effect.Effect<Option.Option<Blob>, BlobsError>;
    /** The blob decoded as UTF-8 text. */
    readonly getText: (key: string) => Effect.Effect<Option.Option<string>, BlobsError>;
    readonly delete: (key: string) => Effect.Effect<void, BlobsError>;
  }
>()("@stash/backend-platform/Blobs") {}

/** Derives `getText` from `get`, so every implementation decodes text the same way. */
export const withText = (blobs: Omit<Blobs["Service"], "getText">): Blobs["Service"] => {
  const decoder = new TextDecoder();
  return {
    ...blobs,
    getText: (key) =>
      Effect.map(
        blobs.get(key),
        Option.map((blob) => decoder.decode(blob.bytes)),
      ),
  };
};

/** Wraps an R2 binding. */
export const make = (bucket: R2Binding): Blobs["Service"] => {
  const call = <A>(operation: BlobsError["operation"], key: string, f: () => Promise<A>) =>
    Effect.tryPromise({ try: f, catch: (cause) => new BlobsError({ operation, key, cause }) });
  return withText({
    put: (key, body, options = {}) =>
      call("put", key, () =>
        bucket.put(
          key,
          body,
          options.contentType === undefined
            ? {}
            : { httpMetadata: { contentType: options.contentType } },
        ),
      ).pipe(Effect.asVoid),
    get: (key) =>
      call("get", key, async () => {
        const object = await bucket.get(key);
        if (object === null) return Option.none();
        return Option.some({
          bytes: new Uint8Array(await object.arrayBuffer()),
          contentType: Option.fromNullishOr(object.httpMetadata?.contentType),
        });
      }),
    delete: (key) => call("delete", key, () => bucket.delete(key)),
  });
};

export const layer = (bucket: R2Binding): Layer.Layer<Blobs> => Layer.succeed(Blobs)(make(bucket));
