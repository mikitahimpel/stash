import * as Links from "@stash/web-links/routes";
import * as OpenTabs from "@stash/web-open-tabs/routes";
import * as Idle from "@stash/web-platform/idle";
import * as Settings from "@stash/web-settings/routes";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

/** The header tabs, by route name: how to load a tab's code, and its code with its first data. */
const tabs: Readonly<
  Record<
    string,
    {
      readonly preload: () => void;
      readonly prefetch: (registry: AtomRegistry.AtomRegistry) => void;
    }
  >
> = {
  links: Links,
  "open-tabs": OpenTabs,
  settings: Settings,
};

/** The route names of the header tabs. */
export const tabNames: ReadonlyArray<string> = Object.keys(tabs);

/**
 * Loads the code of every header tab once the app is idle, so the first switch to a tab doesn't
 * wait for a download before it shows anything. Returns the function that cancels it.
 */
export const preloadWhenIdle = (): (() => void) =>
  Idle.whenIdle(() => {
    for (const tab of Object.values(tabs)) tab.preload();
  });

/**
 * Loads the tab's code and first data: the pointer or a finger is on the tab, so the click is
 * likely a moment away. A tab that was open before refreshes what it has cached.
 */
export const prefetch = (name: string, registry: AtomRegistry.AtomRegistry): void =>
  tabs[name]?.prefetch(registry);
