import * as Kv from "@stash/backend-platform/kv";
import type * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

// A fixed-window counter per principal in KV: one key per principal and window, which expires
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

/** Limits how often one principal may save. */
export class SaveRateLimiter extends Context.Service<
  SaveRateLimiter,
  {
    /** Counts one save, or fails with `RateLimited` if the principal's window is used up. */
    readonly consume: (
      principal: Security.Principal,
    ) => Effect.Effect<void, Errors.RateLimited | Kv.KvError>;
  }
>()("@stash/backend-links/SaveRateLimiter") {}

const principalKey = (principal: Security.Principal): string =>
  principal.kind === "device" ? `device:${principal.deviceId}` : "user";

export const make = (options: Options) =>
  Effect.gen(function* () {
    const kv = yield* Kv.Kv;
    const windowMillis = options.windowSeconds * 1000;
    return SaveRateLimiter.of({
      consume: Effect.fn("SaveRateLimiter.consume")(function* (principal) {
        const now = yield* Clock.currentTimeMillis;
        const windowStart = Math.floor(now / windowMillis) * windowMillis;
        const key = `rate-limit:save:${principalKey(principal)}:${windowStart}`;
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
      }),
    });
  });

/** The limiter over the KV namespace. */
export const layer = (
  options: Options = defaultOptions,
): Layer.Layer<SaveRateLimiter, never, Kv.Kv> => Layer.effect(SaveRateLimiter)(make(options));
