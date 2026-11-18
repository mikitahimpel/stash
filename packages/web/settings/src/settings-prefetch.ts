import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as ConnectAtoms from "@stash/web-connect/connect-atoms";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as SettingsAtoms from "./settings-atoms.ts";

/**
 * Loads what Settings shows when it opens: the devices, tokens and tab reports of its rows, and
 * what the "Devices & connections" section reads.
 */
export const run = (registry: AtomRegistry.AtomRegistry): (() => void) =>
  ApiAtoms.prefetch(registry, [
    SettingsAtoms.devices,
    SettingsAtoms.tokens,
    SettingsAtoms.reports,
    ConnectAtoms.snapshot,
  ]);
