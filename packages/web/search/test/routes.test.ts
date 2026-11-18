import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import * as Routes from "../src/routes.ts";

const router = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/links", name: "links", component: { render: () => null } },
      ...Routes.routes,
    ],
  });

describe("search routes", () => {
  it("sends /search?q=… (what the extension popup opens) to the Inbox with its query", async () => {
    const app = router();
    await app.push("/search?q=effect%20layers");
    expect(app.currentRoute.value.name).toBe("links");
    expect(app.currentRoute.value.path).toBe("/links");
    expect(app.currentRoute.value.query).toEqual({ q: "effect layers" });
  });

  it("opens the Inbox when the link carries no query", async () => {
    const app = router();
    await app.push("/search");
    expect(app.currentRoute.value.fullPath).toBe("/links");
  });
});
