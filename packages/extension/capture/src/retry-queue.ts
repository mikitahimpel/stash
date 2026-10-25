import * as Link from "@stash/contracts-domain/link";
import * as Alarms from "@stash/ext-platform/browser-alarms";
import type { BrowserError } from "@stash/ext-platform/browser-error";
import * as Storage from "@stash/ext-platform/browser-storage";
import type * as StashApiClient from "@stash/ext-platform/stash-api-client";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SaveLink from "./save-link.ts";

/** The `browser.storage.local` key that holds the links still to send, oldest first. */
export const storageKey = "stash/capture/retry-queue";

/** The alarm that wakes the background page to send them. */
export const alarmName = "stash/capture/retry";

/** The most links the queue keeps. When it is full, the oldest one is dropped. */
export const maxSize = 500;

const Stored = Schema.Array(Link.SaveLinkInput);
const decode = Schema.decodeUnknownOption(Stored);

/**
 * Links that could not be saved yet, kept in extension storage so they survive a restart of the
 * browser. An alarm sends them again, because the background page may be suspended in between.
 */
export interface RetryQueue {
  /** Queues `input`, replacing a queued link with the same URL. */
  readonly add: (input: Link.SaveLinkInput) => Effect.Effect<void, BrowserError>;
  /** Sets the alarm to call `flush` in `seconds`. */
  readonly schedule: (seconds: number) => Effect.Effect<void, BrowserError>;
  /**
   * Sends the queued links in order and drops the ones that are saved or rejected. Stops at the
   * first link that can't be sent now and leaves the rest queued, with the alarm set again
   * unless the extension needs setup (a config change flushes then).
   */
  readonly flush: Effect.Effect<void, BrowserError, StashApiClient.StashApiClient>;
  readonly items: Effect.Effect<ReadonlyArray<Link.SaveLinkInput>, BrowserError>;
}

export const make: Effect.Effect<RetryQueue, never, Storage.Storage | Alarms.Alarms> = Effect.gen(
  function* () {
    const storage = yield* Storage.Storage;
    const alarms = yield* Alarms.Alarms;
    // `add` and `flush` read and write the whole list, so they take turns.
    const lock = yield* Semaphore.make(1);

    // A stored value that doesn't decode (for example from an older version) counts as empty.
    const items = Effect.map(storage.get(storageKey), (stored) =>
      Option.getOrElse(Option.flatMap(stored, decode), () => []),
    );
    const store = (links: ReadonlyArray<Link.SaveLinkInput>) =>
      links.length === 0 ? storage.remove(storageKey) : storage.set(storageKey, links);
    const schedule = (seconds: number) =>
      alarms.create(alarmName, {
        delayInMinutes: Math.max(seconds, SaveLink.minRetrySeconds) / 60,
      });

    const add = (input: Link.SaveLinkInput) =>
      lock.withPermit(
        Effect.flatMap(items, (queued) =>
          store([...queued.filter((link) => link.url !== input.url), input].slice(-maxSize)),
        ),
      );

    const flush = lock.withPermit(
      Effect.gen(function* () {
        const remaining = [...(yield* items)];
        while (remaining.length > 0) {
          const result = yield* SaveLink.save(remaining[0]!);
          if (result._tag === "Retry") return yield* schedule(result.afterSeconds);
          if (result._tag === "NeedsSetup") return;
          remaining.shift();
          // Store after every link, so a suspended page never sends one twice.
          yield* store(remaining);
        }
        yield* alarms.clear(alarmName);
      }),
    );

    return { add, schedule, flush, items };
  },
);
