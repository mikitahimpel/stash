import type * as Link from "@stash/contracts-domain/link";
import * as SaveCurrentTab from "@stash/ext-capture/save-current-tab";
import * as Tabs from "@stash/ext-platform/browser-tabs";
import * as StashApiClient from "@stash/ext-platform/stash-api-client";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PopupLink from "./popup-link.ts";

/** How often the popup asks whether a saved link was enriched yet. */
export const watchInterval = Duration.seconds(2);

/** How many times it asks before it gives up: enrichment usually takes a few seconds. */
export const watchAttempts = 20;

/** What became of the popup's Save. */
export type SaveResult =
  | {
      readonly _tag: "Saved";
      readonly link: PopupLink.PopupLink;
      /** `false` when the page was in Stash already. */
      readonly created: boolean;
    }
  | { readonly _tag: "Failed"; readonly message: string };

/** What became of Undo. */
export type UndoResult =
  | { readonly _tag: "Removed" }
  | { readonly _tag: "Failed"; readonly message: string };

const unreachable = "Could not reach Stash. Try again.";
const notConnected = "This browser is not connected to Stash.";

/**
 * Saves the active tab with `POST /links`. Never fails: every error becomes a message for the
 * popup. Unlike the hotkey, a failed save is not queued, since the popup says so at once.
 */
export const save: Effect.Effect<SaveResult, never, Tabs.Tabs | StashApiClient.StashApiClient> =
  Effect.gen(function* () {
    const tabs = yield* Tabs.Tabs;
    const input = Option.flatMap(yield* tabs.current, SaveCurrentTab.toInput);
    if (Option.isNone(input)) {
      return { _tag: "Failed", message: "Only http(s) pages can be saved to Stash." } as const;
    }
    const client = yield* StashApiClient.StashApiClient;
    const { created, ...link } = yield* client.links.save({ payload: input.value });
    return { _tag: "Saved", link: PopupLink.fromLink(link), created } as const;
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed<SaveResult>({
        _tag: "Failed",
        message:
          error._tag === "RateLimited"
            ? `Stash is rate limiting saves. Try again in ${error.retryAfterSeconds} s.`
            : error._tag === "Unauthorized" || error._tag === "ConfigError"
              ? notConnected
              : unreachable,
      }),
    ),
  );

/** Takes a link out of Stash again (`DELETE /links/:id`). A link that is gone counts as removed. */
export const undo = (
  id: Link.LinkId,
): Effect.Effect<UndoResult, never, StashApiClient.StashApiClient> =>
  Effect.flatMap(StashApiClient.StashApiClient, (client) =>
    client.links.remove({ params: { id } }),
  ).pipe(
    Effect.as<UndoResult>({ _tag: "Removed" }),
    Effect.catch((error) =>
      Effect.succeed<UndoResult>(
        error._tag === "NotFound"
          ? { _tag: "Removed" }
          : {
              _tag: "Failed",
              message:
                error._tag === "Unauthorized" || error._tag === "ConfigError"
                  ? notConnected
                  : unreachable,
            },
      ),
    ),
  );

/**
 * Follows a saved link while enrichment runs: asks for it every `watchInterval` and hands each
 * answer to `onUpdate`, until it is enriched, `watchAttempts` have passed or the api fails.
 */
export const watch = (
  id: Link.LinkId,
  onUpdate: (link: PopupLink.PopupLink) => void,
): Effect.Effect<void, never, StashApiClient.StashApiClient> =>
  Effect.gen(function* () {
    const client = yield* StashApiClient.StashApiClient;
    for (let attempt = 0; attempt < watchAttempts; attempt++) {
      yield* Effect.sleep(watchInterval);
      const link = PopupLink.fromLink(yield* client.links.get({ params: { id } }));
      onUpdate(link);
      if (link.enriched) return;
    }
  }).pipe(Effect.ignore);
