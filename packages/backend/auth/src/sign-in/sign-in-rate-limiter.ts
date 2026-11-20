import * as Kv from "@stash/backend-platform/kv";
import * as Errors from "@stash/contracts-domain/errors";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

// A fixed-window counter per client IP and action in KV, like the device flow's: it stops a
// script from guessing at the open sign-in endpoints or filling KV with challenges. KV has no
// atomic increment, so concurrent calls near the limit may each pass.

/** What is counted, each on its own. */
export type Action = "passkey" | "passkey-sign-up" | "google";

export interface Options {
  /** Calls of one action one IP may make per window. */
  readonly limit: number;
  readonly windowSeconds: number;
}

export const defaultOptions: Options = { limit: 30, windowSeconds: 60 };

/** KV rejects an `expirationTtl` below 60 seconds. */
const minimumTtlSeconds = 60;

export class SignInRateLimiter extends Context.Service<
  SignInRateLimiter,
  {
    /** Counts one call, or fails with `RateLimited` once the IP's window is used up. */
    readonly consume: (action: Action, ip: string) => Effect.Effect<void, Errors.RateLimited>;
  }
>()("@stash/backend-auth/SignInRateLimiter") {}

export const make = (options: Options) =>
  Effect.gen(function* () {
    const kv = yield* Kv.Kv;
    const windowMillis = options.windowSeconds * 1000;
    return SignInRateLimiter.of({
      consume: Effect.fn("SignInRateLimiter.consume")(function* (action, ip) {
        const now = yield* Clock.currentTimeMillis;
        const windowStart = Math.floor(now / windowMillis) * windowMillis;
        const key = `rate-limit:sign-in:${action}:${ip}:${windowStart}`;
        const stored = yield* kv.get(key).pipe(Effect.orDie);
        const used = Option.match(stored, {
          onNone: () => 0,
          onSome: (value) => Number.parseInt(value, 10) || 0,
        });
        if (used >= options.limit) {
          return yield* new Errors.RateLimited({
            retryAfterSeconds: Math.ceil((windowStart + windowMillis - now) / 1000),
          });
        }
        yield* kv
          .put(key, String(used + 1), {
            expirationTtl: Math.max(options.windowSeconds, minimumTtlSeconds),
          })
          .pipe(Effect.orDie);
      }),
    });
  });

/** The limiter over the KV namespace. */
export const layer = (
  options: Options = defaultOptions,
): Layer.Layer<SignInRateLimiter, never, Kv.Kv> => Layer.effect(SignInRateLimiter)(make(options));
