import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import * as LinkBack from "../src/details/link-back.ts";
import { routes } from "../src/routes.ts";

// The router of a link's page whose history says `previous` is the page before it.
const cameFrom = (previous: string | null) => {
  const history = createMemoryHistory();
  const settings = { path: "/settings", name: "settings", component: { render: () => null } };
  const router = createRouter({ history, routes: [...routes, settings] });
  return {
    options: { ...router.options, history: { ...history, state: { back: previous } } },
    resolve: router.resolve,
  };
};

describe("LinkBack", () => {
  it("steps back to the Inbox it was opened from, filters and all", () => {
    expect(LinkBack.from(cameFrom("/links?feed=unseen&tag=go"))).toEqual({
      label: "Inbox",
      history: true,
    });
  });

  it("steps back to the search results the Inbox was showing", () => {
    expect(LinkBack.from(cameFrom("/links?q=economics"))).toEqual({
      label: "Results",
      history: true,
    });
  });

  it("opens the Inbox when there is no list to go back to", () => {
    const inbox = { label: "Inbox", history: false };
    expect(LinkBack.from(cameFrom(null))).toEqual(inbox);
    expect(LinkBack.from(cameFrom("/settings"))).toEqual(inbox);
    expect(LinkBack.from(cameFrom("/links/another"))).toEqual(inbox);
  });
});
