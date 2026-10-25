import type * as Command from "@stash/contracts-domain/command";
import * as Tabs from "@stash/ext-platform/browser-tabs";
import * as Effect from "effect/Effect";

/** What a device reports back for a command. */
export type Outcome = "done" | "failed";

// Compares URLs the way the browser prints them, so `https://example.com` matches the tab URL
// `https://example.com/`. A URL that doesn't parse is compared as is.
const normalize = (url: string): string => {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
};

/**
 * Closes every open tab whose URL matches. No matching tab is still `done`: the tab is already
 * gone, which is what the command asked for. `failed` when the browser refuses to close a tab.
 */
export const closeTab = (
  payload: Command.CloseTabPayload,
): Effect.Effect<Outcome, never, Tabs.Tabs> =>
  Effect.gen(function* () {
    const tabs = yield* Tabs.Tabs;
    const url = normalize(payload.url);
    const open = yield* tabs.query();
    const ids = open.filter((tab) => tab.url !== null && normalize(tab.url) === url);
    yield* tabs.remove(ids.map((tab) => tab.id));
    return "done" as const;
  }).pipe(
    Effect.catchTag("BrowserError", (error) =>
      Effect.as(Effect.logWarning("close-tab failed", error), "failed" as const),
    ),
  );

/** Runs a command on this device. Never fails: every problem becomes `failed`. */
export const execute = (
  payload: Command.CommandPayload,
): Effect.Effect<Outcome, never, Tabs.Tabs> => {
  switch (payload.kind) {
    case "close-tab":
      return closeTab(payload);
  }
};
