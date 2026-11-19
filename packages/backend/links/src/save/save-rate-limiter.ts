import * as Kv from "@stash/backend-platform/kv";
import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

// A fixed-window counter per user in KV: one key per user and window, which expires
// after the window. KV is eventually consistent and has no atomic increment, so concurrent saves
// from several locations may each pass near the limit. That is enough to stop a runaway client.

export interface Options {
  /** Saves allowed per window. A batch counts as one save. */
  readonly limit: number;
  readonly windowSeconds: number;
}

export const defaultOptions: Options = { limit: 120, windowSeconds: 60 };

/** KV rejects an `expirationTtl` below 60 seconds. */
const minimumTtlSeconds = 60;

/**
 * Limits how often one user may save, whichever of their devices or tokens does it: one user's
 * runaway client never uses up another user's window.
 */
export class SaveRateLimiter extends Context.Service<
  SaveRateLimiter,
  {
    /** Counts one save, or fails with `RateLimited` if the current user's window is used up. */
    readonly consume: Effect.Effect<void, Errors.RateLimited | Kv.KvError, Security.CurrentUser>;
  }
>()("@stash/backend-links/SaveRateLimiter") {}

export const make = (options: Options) =>
  Effect.gen(function* () {
    const kv = yield* Kv.Kv;
    const windowMillis = options.windowSeconds * 1000;
    return SaveRateLimiter.of({
      consume: Effect.gen(function* () {
        const user = yield* Security.CurrentUser;
        const now = yield* Clock.currentTimeMillis;
        const windowStart = Math.floor(now / windowMillis) * windowMillis;
        const key = `rate-limit:save:user:${user.id}:${windowStart}`;
        const used = Option.match(yield* kv.get(key), {
          onNone: () => 0,
          onSome: (value) => Number.parseInt(value, 10) || 0,
        });
        if (used >= options.limit) {
          return yield* new Errors.RateLimited({
            retryAfterSeconds: Math.ceil((windowStart + windowMillis - now) / 1000),
          });
        }
        yield* kv.put(key, String(used + 1), {
          expirationTtl: Math.max(options.windowSeconds, minimumTtlSeconds),
        });
      }).pipe(Effect.withSpan("SaveRateLimiter.consume")),
    });
  });

/** The limiter over the KV namespace. */
export const layer = (
  options: Options = defaultOptions,
): Layer.Layer<SaveRateLimiter, never, Kv.Kv> => Layer.effect(SaveRateLimiter)(make(options));
