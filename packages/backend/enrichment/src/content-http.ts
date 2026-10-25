import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as Schedule from "effect/Schedule";

/** How content is fetched. Override it with `Effect.provideService(FetchPolicy, ...)`. */
export interface Policy {
  /** The time limit for one attempt, including reading the body. */
  readonly timeout: Duration.Input;
  /** The delays between attempts. Only transient failures are retried. */
  readonly retrySchedule: Schedule.Schedule<unknown, ContentFetchError>;
  /** Retries after the first attempt. */
  readonly retries: number;
  /** Longer texts are cut to this many characters. */
  readonly maxTextLength: number;
}

export const defaultPolicy: Policy = {
  timeout: "10 seconds",
  retrySchedule: Schedule.exponential("500 millis").pipe(Schedule.jittered),
  retries: 2,
  maxTextLength: 100_000,
};

export const FetchPolicy = Context.Reference<Policy>("@stash/backend-enrichment/FetchPolicy", {
  defaultValue: () => defaultPolicy,
});

export class ContentFetchError extends Data.TaggedError("ContentFetchError")<{
  readonly url: string;
  readonly reason: "Timeout" | "Transport" | "Status" | "Decode" | "UnsupportedContentType";
  /** The response status, for `Status`. */
  readonly status?: number;
  readonly cause?: unknown;
}> {
  /** Worth another attempt: timeouts, network errors, 408, 429 and 5xx. */
  get isTransient(): boolean {
    switch (this.reason) {
      case "Timeout":
      case "Transport":
        return true;
      case "Status":
        return this.status === 408 || this.status === 429 || (this.status ?? 0) >= 500;
      default:
        return false;
    }
  }
}

export interface TextResponse {
  readonly status: number;
  /** The `content-type` header, lowercased, or `""`. */
  readonly contentType: string;
  readonly body: string;
}

/** Identifies the fetcher to sites. Contains no personal values. */
export const userAgent = "Mozilla/5.0 (compatible; StashBot/1.0)";

const toError = (url: string, cause: unknown): ContentFetchError => {
  if (Cause.isTimeoutError(cause)) return new ContentFetchError({ url, reason: "Timeout", cause });
  if (cause instanceof HttpClientError.HttpClientError) {
    const reason = cause.reason;
    if (reason._tag === "StatusCodeError") {
      return new ContentFetchError({
        url,
        reason: "Status",
        status: reason.response.status,
        cause,
      });
    }
    if (reason._tag === "TransportError") {
      return new ContentFetchError({ url, reason: "Transport", cause });
    }
  }
  return new ContentFetchError({ url, reason: "Decode", cause });
};

/**
 * GETs `url` and reads the body as text. Non-2xx statuses fail. Each attempt is bounded by the
 * policy's `timeout`, and transient failures are retried on the policy's schedule.
 */
export const getText = (
  url: string,
  headers: Readonly<Record<string, string>> = {},
): Effect.Effect<TextResponse, ContentFetchError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
    const policy = yield* FetchPolicy;
    const attempt = client.get(url, { headers: { "user-agent": userAgent, ...headers } }).pipe(
      Effect.flatMap((response) =>
        Effect.map(response.text, (body) => ({
          status: response.status,
          contentType: (response.headers["content-type"] ?? "").toLowerCase(),
          body,
        })),
      ),
      Effect.timeout(policy.timeout),
      Effect.mapError((cause) => toError(url, cause)),
    );
    return yield* Effect.retry(attempt, {
      schedule: policy.retrySchedule,
      times: policy.retries,
      while: (error) => error.isTransient,
    });
  });
