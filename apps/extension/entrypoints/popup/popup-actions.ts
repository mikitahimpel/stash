import type * as Link from "@stash/contracts-domain/link";
import type * as Live from "@stash/ext-platform/live";
import * as OpenStash from "@stash/ext-popup/open-stash";
import type * as PopupLink from "@stash/ext-popup/popup-link";
import * as PopupView from "@stash/ext-popup/popup-view";
import * as SavePage from "@stash/ext-popup/save-page";
import type * as ManagedRuntime from "effect/ManagedRuntime";

/** What the popup page can ask for. Each call runs a `@stash/ext-popup` effect. */
export interface Actions {
  /** The tab the popup was opened on: local, so it answers at once. */
  readonly page: () => Promise<PopupView.Page | null>;
  /** The connection, the page's saved link and the recent links, from the api. */
  readonly load: () => Promise<PopupView.View>;
  readonly save: () => Promise<SavePage.SaveResult>;
  readonly undo: (id: Link.LinkId) => Promise<SavePage.UndoResult>;
  /** Follows a link until it is enriched. Resolves when it stops. */
  readonly watch: (id: Link.LinkId, onUpdate: (link: PopupLink.PopupLink) => void) => Promise<void>;
  readonly openStash: (webOrigin: string) => Promise<void>;
  readonly search: (webOrigin: string, query: string) => Promise<void>;
  readonly openLink: (url: string) => Promise<void>;
  /** Opens the options page, where pairing runs. */
  readonly connect: () => Promise<void>;
}

/** The popup's actions on `runtime`: the live platform in the popup, in-memory layers in tests. */
export const make = (runtime: ManagedRuntime.ManagedRuntime<Live.Services, never>): Actions => ({
  page: () => runtime.runPromise(PopupView.currentPage),
  load: () => runtime.runPromise(PopupView.load),
  save: () => runtime.runPromise(SavePage.save),
  undo: (id) => runtime.runPromise(SavePage.undo(id)),
  watch: (id, onUpdate) => runtime.runPromise(SavePage.watch(id, onUpdate)),
  openStash: (webOrigin) => runtime.runPromise(OpenStash.openStash(webOrigin)),
  search: (webOrigin, query) => runtime.runPromise(OpenStash.search(webOrigin, query)),
  openLink: (url) => runtime.runPromise(OpenStash.openLink(url)),
  connect: () => runtime.runPromise(OpenStash.connect),
});
