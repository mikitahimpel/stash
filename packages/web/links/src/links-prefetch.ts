import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as LinksAtoms from "./links-atoms.ts";
import * as SavedRead from "./list/saved-read.ts";

/** Loads what the Inbox shows when it opens from the nav: the plain feed and its counts. */
export const run = (registry: AtomRegistry.AtomRegistry): (() => void) =>
  ApiAtoms.prefetch(registry, [
    LinksAtoms.feed(LinksAtoms.defaultFilters),
    LinksAtoms.anySaved,
    LinksAtoms.devices,
    SavedRead.recent,
  ]);
