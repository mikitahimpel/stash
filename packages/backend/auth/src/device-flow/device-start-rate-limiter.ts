import * as Kv from "@stash/backend-platform/kv";
import * as Errors from "@stash/contracts-domain/errors";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

// A fixed-window counter per client IP in KV, like the save rate limiter: one key per IP and
// window, which expires after the window. KV is eventually consistent and has no atomic
// increment, so concurrent starts may each pass near the limit. That is enough to stop a script
// from burning the GitHub app's device flow quota.

export interface Options {
  /** Device flows one IP may start per window. */
  readonly limit: number;
  readonly windowSeconds: number;
}

export const defaultOptions: Options = { limit: 10, windowSeconds: 60 };

/** KV rejects an `expirationTtl` below 60 seconds. */
const minimumTtlSeconds = 60;

/** Limits how often one IP may start a device flow. */
export class DeviceStartRateLimiter extends Context.Service<
  DeviceStartRateLimiter,
  {
    /** Counts one start, or fails with `RateLimited` if the IP's window is used up. */
    readonly consume: (ip: string) => Effect.Effect<void, Errors.RateLimited | Kv.KvError>;
  }
>()("@stash/backend-auth/DeviceStartRateLimiter") {}

export const make = (options: Options) =>
  Effect.gen(function* () {
    const kv = yield* Kv.Kv;
    const windowMillis = options.windowSeconds * 1000;
    return DeviceStartRateLimiter.of({
      consume: Effect.fn("DeviceStartRateLimiter.consume")(function* (ip) {
        const now = yield* Clock.currentTimeMillis;
        const windowStart = Math.floor(now / windowMillis) * windowMillis;
        const key = `rate-limit:device-start:${ip}:${windowStart}`;
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
): Layer.Layer<DeviceStartRateLimiter, never, Kv.Kv> =>
  Layer.effect(DeviceStartRateLimiter)(make(options));
