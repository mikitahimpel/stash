import * as Links from "@stash/contracts-api/links";
import * as Link from "@stash/contracts-domain/link";
import { Array as Arr, Console, Data, Duration, Effect, Option, Schedule, Schema } from "effect";
import type * as CraftExportParser from "./craft-export-parser.ts";
import * as StashApiClient from "./stash-api-client.ts";
import type * as ZenSessionParser from "./zen-session-parser.ts";

/**
 * Turns parsed links into `POST /links/batch` calls. The import is resume-safe: the api dedupes by
 * canonical URL, so running it again after a failure (or twice) stores every link once. Batches go
 * out one at a time, and transient failures (rate limits, transport errors, 5xx) are retried with
 * an exponential `Schedule`.
 */

export class BatchImportError extends Data.TaggedError("BatchImportError")<{
  readonly message: string;
}> {}

/** A link as a source found it, before validation. */
export interface Candidate {
  readonly url: string;
  readonly title: string | null;
}

/** The links of one source, ready to post, and how many candidates were dropped. */
export interface ImportSet {
  readonly links: ReadonlyArray<Link.SaveLinkInput>;
  /** Candidates whose URL repeats an earlier one. */
  readonly duplicates: number;
  /** Candidates whose URL the api would reject (not an absolute `http(s)` URL). */
  readonly invalid: number;
}

/** The default number of links per request. The api accepts up to `Links.maxBatchSize`. */
export const defaultBatchSize = 100;

const maxTitleLength = 1000;

const decodeUrl = Schema.decodeUnknownOption(Link.Url);

const toTitle = (title: string | null): string | null => {
  const trimmed = title?.trim() ?? "";
  return trimmed === "" ? null : trimmed.slice(0, maxTitleLength);
};

/**
 * Validates and dedupes candidates by URL. The first candidate decides the order; a later one only
 * supplies the title when the earlier ones have none.
 */
export const collect = (candidates: Iterable<Candidate>): ImportSet => {
  const byUrl = new Map<Link.Url, string | null>();
  let duplicates = 0;
  let invalid = 0;
  for (const candidate of candidates) {
    const url = decodeUrl(candidate.url.trim());
    if (Option.isNone(url)) {
      invalid++;
      continue;
    }
    const title = toTitle(candidate.title);
    if (byUrl.has(url.value)) {
      duplicates++;
      if (byUrl.get(url.value) === null) byUrl.set(url.value, title);
    } else {
      byUrl.set(url.value, title);
    }
  }
  const links = [...byUrl].map(([url, title]) => (title === null ? { url } : { url, title }));
  return { links, duplicates, invalid };
};

/** Every tab of every window, in session order. */
export const fromZenSession = (session: ZenSessionParser.ZenSession): ImportSet =>
  collect(session.windows.flatMap((window) => window.tabs));

/** Every link of a Craft export. The parser already deduped them. */
export const fromCraftLinks = (links: ReadonlyArray<CraftExportParser.CraftLink>): ImportSet =>
  collect(links);

/** Splits links into batches of at most `batchSize` (clamped to `1..Links.maxBatchSize`). */
export const toBatches = (
  links: ReadonlyArray<Link.SaveLinkInput>,
  batchSize: number,
): ReadonlyArray<ReadonlyArray<Link.SaveLinkInput>> =>
  Arr.chunksOf(links, Math.min(Math.max(Math.trunc(batchSize), 1), Links.maxBatchSize));

/** Prints what an import would send, without calling the api. */
export const printPlan = (set: ImportSet, batchSize: number): Effect.Effect<void> =>
  Console.log(
    [
      `links: ${set.links.length}`,
      `duplicates skipped: ${set.duplicates}`,
      `invalid skipped: ${set.invalid}`,
      `batches: ${toBatches(set.links, batchSize).length}`,
    ].join("\n"),
  );

export interface RetryOptions {
  /** Retries per batch after the first attempt. */
  readonly times: number;
  /** Delay before the first retry. It doubles each time, with jitter. */
  readonly baseDelay: Duration.Input;
}

export const defaultRetry: RetryOptions = { times: 5, baseDelay: "1 second" };

interface Failure {
  readonly _tag: string;
  readonly retryAfterSeconds?: number;
  readonly reason?: { readonly _tag: string; readonly response?: { readonly status: number } };
}

/** Rate limits, transport failures and 5xx answers may pass on their own; anything else won't. */
export const isTransient = (error: Failure): boolean => {
  if (error._tag === "RateLimited") return true;
  if (error._tag !== "HttpClientError" || error.reason === undefined) return false;
  // A 5xx the api did not declare arrives as a `DecodeError` or `StatusCodeError` with the response.
  const { reason } = error;
  return reason._tag === "TransportError" || (reason.response?.status ?? 0) >= 500;
};

const retrySchedule = (options: RetryOptions) =>
  Schedule.exponential(options.baseDelay).pipe(
    Schedule.jittered,
    Schedule.setInputType<Failure>(),
    // Never retry a rate limit sooner than the api asked for.
    Schedule.modifyDelay(({ input, duration }) =>
      Effect.succeed(
        input.retryAfterSeconds === undefined
          ? duration
          : Duration.max(duration, Duration.seconds(input.retryAfterSeconds)),
      ),
    ),
  );

export interface ImportOptions {
  readonly batchSize: number;
  readonly retry?: RetryOptions | undefined;
}

export interface ImportResult {
  readonly batches: number;
  /** Links the api answered with, after its dedupe. */
  readonly saved: number;
}

/** Posts every link, one batch at a time, and prints progress per batch. */
export const importLinks = (
  set: ImportSet,
  options: ImportOptions,
): Effect.Effect<ImportResult, BatchImportError, StashApiClient.StashApiClient> =>
  Effect.gen(function* () {
    const client = yield* StashApiClient.StashApiClient;
    const retry = options.retry ?? defaultRetry;
    const batches = toBatches(set.links, options.batchSize);
    let saved = 0;
    for (const [index, links] of batches.entries()) {
      const result = yield* client.links.saveBatch({ payload: { links } }).pipe(
        Effect.retry({ schedule: retrySchedule(retry), times: retry.times, while: isTransient }),
        Effect.mapError(
          (error) =>
            new BatchImportError({
              message:
                `batch ${index + 1}/${batches.length} failed (${error._tag}). ` +
                `Batches before it are stored; rerun the import to resume.`,
            }),
        ),
      );
      saved += result.links.length;
      yield* Console.log(`batch ${index + 1}/${batches.length}: ${result.links.length} saved`);
    }
    return { batches: batches.length, saved };
  });
