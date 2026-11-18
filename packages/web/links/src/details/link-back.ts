import type { Router } from "vue-router";

/** Where the back link of a link's page leads. */
export interface Back {
  readonly label: string;
  /**
   * Step back in the history: the page before this one was the Inbox, and going back to it keeps
   * its filters or search (they are in its URL) and its scroll position. Otherwise the link opens
   * the Inbox.
   */
  readonly history: boolean;
}

/**
 * The back link for the page `router` is on. A link opened from the Inbox goes back there, or to
 * the search results the Inbox was showing (`?q=`). One opened directly (a new tab, a bookmark)
 * or from elsewhere goes to the Inbox.
 */
export const from = (router: Pick<Router, "options" | "resolve">): Back => {
  const previous = router.options.history.state["back"];
  const route = typeof previous === "string" ? router.resolve(previous) : undefined;
  return route?.name !== "links"
    ? { label: "Inbox", history: false }
    : { label: route.query["q"] ? "Results" : "Inbox", history: true };
};
