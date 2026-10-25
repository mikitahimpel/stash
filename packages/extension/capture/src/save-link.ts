import type * as Link from "@stash/contracts-domain/link";
import * as StashApiClient from "@stash/ext-platform/stash-api-client";
import * as Effect from "effect/Effect";

/** Wait this long before retrying when the API is unreachable. */
export const offlineRetrySeconds = 60;

/** Firefox clamps alarms to about 30 seconds, so never retry sooner. */
export const minRetrySeconds = 30;

/**
 * What became of one `POST /links`:
 * - `Saved`: stored.
 * - `Retry`: worth trying again after `afterSeconds` (rate limited, offline, 5xx).
 * - `NeedsSetup`: no config yet, or the API rejected the device token. Try again once the
 *   config changes.
 * - `Rejected`: the API won't take it, trying again won't help.
 */
export type Result =
  | { readonly _tag: "Saved"; readonly link: Link.Link }
  | {
      readonly _tag: "Retry";
      readonly reason: "RateLimited" | "Offline";
      readonly afterSeconds: number;
    }
  | { readonly _tag: "NeedsSetup" }
  | { readonly _tag: "Rejected" };

type Links = StashApiClient.StashApiClient["Service"]["links"];

/** What `POST /links` or `POST /links/batch` can fail with. */
export type SaveError =
  | Effect.Error<ReturnType<Links["save"]>>
  | Effect.Error<ReturnType<Links["saveBatch"]>>;

/** Turns a failed save into a `Result`. */
export const classify = (error: SaveError): Exclude<Result, { readonly _tag: "Saved" }> => {
  switch (error._tag) {
    case "RateLimited":
      return {
        _tag: "Retry",
        reason: "RateLimited",
        afterSeconds: Math.max(error.retryAfterSeconds, minRetrySeconds),
      };
    case "ConfigError":
    case "Unauthorized":
      return { _tag: "NeedsSetup" };
    case "HttpClientError": {
      // An unexpected status arrives as `StatusCodeError` or, when its body isn't the JSON the
      // client expects, as `DecodeError`. Both carry the response.
      const reason = error.reason;
      const status = "response" in reason ? reason.response.status : null;
      const transient =
        reason._tag === "TransportError" || (status !== null && (status >= 500 || status === 408));
      return transient
        ? { _tag: "Retry", reason: "Offline", afterSeconds: offlineRetrySeconds }
        : { _tag: "Rejected" };
    }
    default:
      return { _tag: "Rejected" };
  }
};

/** Sends `POST /links`. Never fails: every error becomes a `Result`. */
export const save = (
  input: Link.SaveLinkInput,
): Effect.Effect<Result, never, StashApiClient.StashApiClient> =>
  Effect.flatMap(StashApiClient.StashApiClient, (client) =>
    client.links.save({ payload: input }).pipe(
      Effect.map((link): Result => ({ _tag: "Saved", link })),
      Effect.catch((error) =>
        Effect.as(Effect.logWarning("capture: POST /links failed", error._tag), classify(error)),
      ),
    ),
  );
