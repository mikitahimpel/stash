import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

/**
 * A `browser.*` call rejected. `api` names the call, for example `"tabs.query"`.
 */
export class BrowserError extends Data.TaggedError("BrowserError")<{
  readonly api: string;
  readonly cause?: unknown;
}> {}

/** Runs a `browser.*` call that returns a promise, failing with `BrowserError`. */
export const tryCall = <A>(api: string, call: () => Promise<A>): Effect.Effect<A, BrowserError> =>
  Effect.tryPromise({ try: call, catch: (cause) => new BrowserError({ api, cause }) });
