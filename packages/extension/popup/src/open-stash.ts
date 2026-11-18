import * as Tabs from "@stash/ext-platform/browser-tabs";
import * as ExtensionPages from "@stash/ext-platform/extension-pages";
import * as Effect from "effect/Effect";

// What the popup opens. Each action ends by closing the popup, also when the browser call failed:
// there is nothing more to do in it.

const thenClose = <R>(effect: Effect.Effect<void, unknown, R>) =>
  effect.pipe(
    Effect.ignore({ log: "Warn" }),
    Effect.andThen(Effect.flatMap(ExtensionPages.ExtensionPages, (pages) => pages.closeCurrent)),
  );

const isAt = (origin: string) => (tab: Tabs.Tab) =>
  tab.url !== null && (tab.url === origin || tab.url.startsWith(`${origin}/`));

/**
 * Opens the web app: switches to a Stash tab when one is open (the current window's first), and
 * opens a new tab otherwise.
 */
export const openStash = (webOrigin: string) =>
  thenClose(
    Effect.gen(function* () {
      const tabs = yield* Tabs.Tabs;
      const here = yield* tabs.query({ currentWindow: true });
      const open = here.find(isAt(webOrigin)) ?? (yield* tabs.query()).find(isAt(webOrigin));
      yield* open === undefined ? tabs.open(`${webOrigin}/`) : tabs.focus(open.id);
    }),
  );

/** The web app's search page for `query`. */
export const searchUrl = (webOrigin: string, query: string): string =>
  `${webOrigin}/search?q=${encodeURIComponent(query.trim())}`;

/** Opens the search for `query` in a new tab. A blank query just opens Stash. */
export const search = (webOrigin: string, query: string) =>
  query.trim() === ""
    ? openStash(webOrigin)
    : thenClose(Effect.flatMap(Tabs.Tabs, (tabs) => tabs.open(searchUrl(webOrigin, query))));

/** Opens a saved link in a new tab. */
export const openLink = (url: string) =>
  thenClose(Effect.flatMap(Tabs.Tabs, (tabs) => tabs.open(url)));

/**
 * Starts pairing: opens the options page, where the pairing flow runs. It can't run in the popup,
 * which closes as soon as the approval tab opens.
 */
export const connect = thenClose(
  Effect.flatMap(ExtensionPages.ExtensionPages, (pages) => pages.openOptions),
);
