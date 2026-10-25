import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export interface PutOptions {
  /** Seconds until the key expires. Cloudflare requires at least 60. */
  readonly expirationTtl?: number;
}

export class KvError extends Data.TaggedError("KvError")<{
  readonly operation: "get" | "put" | "delete";
  readonly key: string;
  readonly cause: unknown;
}> {}

/** The part of the KV binding this package uses. `KVNamespace` satisfies it. */
export interface KvBinding {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The KV namespace (sessions, OAuth state, rate limits). Values are strings. */
export class Kv extends Context.Service<
  Kv,
  {
    readonly get: (key: string) => Effect.Effect<Option.Option<string>, KvError>;
    readonly put: (
      key: string,
      value: string,
      options?: PutOptions,
    ) => Effect.Effect<void, KvError>;
    readonly delete: (key: string) => Effect.Effect<void, KvError>;
  }
>()("@stash/backend-platform/Kv") {}

/** Wraps a KV binding. */
export const make = (kv: KvBinding): Kv["Service"] => {
  const call = <A>(operation: KvError["operation"], key: string, f: () => Promise<A>) =>
    Effect.tryPromise({ try: f, catch: (cause) => new KvError({ operation, key, cause }) });
  return {
    get: (key) => call("get", key, () => kv.get(key)).pipe(Effect.map(Option.fromNullishOr)),
    put: (key, value, options = {}) =>
      call("put", key, () =>
        kv.put(
          key,
          value,
          options.expirationTtl === undefined ? {} : { expirationTtl: options.expirationTtl },
        ),
      ),
    delete: (key) => call("delete", key, () => kv.delete(key)),
  };
};

export const layer = (kv: KvBinding): Layer.Layer<Kv> => Layer.succeed(Kv)(make(kv));
