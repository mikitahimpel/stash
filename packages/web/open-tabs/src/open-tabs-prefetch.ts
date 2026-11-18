import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as OpenTabsAtoms from "./open-tabs-atoms.ts";

/** Loads what "Open now" shows when it opens: every device's tabs. */
export const run = (registry: AtomRegistry.AtomRegistry): (() => void) =>
  ApiAtoms.prefetch(registry, [OpenTabsAtoms.tabs]);
