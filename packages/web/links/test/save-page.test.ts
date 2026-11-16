import * as ApiTesting from "@stash/web-api-client/testing";
import { enableAutoUnmount } from "@vue/test-utils";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Fixtures from "./fixtures.ts";
import { mountAt } from "./mount-page.ts";

enableAutoUnmount(afterEach);

describe("/save page", () => {
  const saved: Array<unknown> = [];
  const routes: ApiTesting.Routes = {
    "POST /links": (request) =>
      Effect.map(Fixtures.body(request), (payload) => {
        const body = payload as { url: string; title?: string };
        saved.push(body);
        return ApiTesting.json(
          Fixtures.link("s", {
            url: body.url,
            title: body.title ?? null,
            createdAt: new Date().toISOString(),
          }),
          201,
        );
      }),
    "GET /links": () => Fixtures.page([]),
    "DELETE /links/:id": (_, { id }) => {
      removed.push(id ?? "");
      return new Response(null, { status: 204 });
    },
  };
  const removed: Array<string> = [];
  afterEach(() => {
    saved.length = 0;
    removed.length = 0;
  });

  it("saves the link from a Shortcut once, with its device, and says so", async () => {
    const { wrapper } = await mountAt(
      "/save?device=device-ios&url=https://example.com/a?b=1&c=2",
      routes,
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain("Saved ✓"));
    expect(saved).toEqual([{ url: "https://example.com/a?b=1&c=2", deviceId: "device-ios" }]);
    // The host shows, so a save another page asked for is visible.
    expect(wrapper.text()).toContain("example.com");
  });

  it("undoes the save in one tap", async () => {
    const { wrapper } = await mountAt("/save?url=https://example.com/unwanted", routes);
    await vi.waitFor(() => expect(wrapper.find("[data-action=undo]").exists()).toBe(true));
    await wrapper.find("[data-action=undo]").trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).toContain("Removed"));
    expect(removed).toEqual(["s"]);
  });

  it("offers no Undo when the link was stored before", async () => {
    const { wrapper } = await mountAt("/save?url=https://example.com/old", {
      ...routes,
      "POST /links": () => ApiTesting.json(Fixtures.link("old"), 201),
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain("Already saved ✓"));
    expect(wrapper.find("[data-action=undo]").exists()).toBe(false);
  });

  it("shows the bookmarklet's title", async () => {
    const { wrapper } = await mountAt(
      "/save?title=A%20synthetic%20page&url=https%3A%2F%2Fexample.com%2Fb",
      routes,
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain("Saved ✓ A synthetic page"));
  });

  it("goes to the Inbox on Back when the page has no history", async () => {
    const { wrapper, router } = await mountAt("/save?url=https://example.com/c", routes);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Saved ✓"));
    await wrapper.find("[data-action=back]").trigger("click");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("links"));
  });

  it("refuses an address with no link, and saves nothing", async () => {
    const { wrapper } = await mountAt("/save?url=not-a-link", routes);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Nothing to save"));
    expect(saved).toEqual([]);
  });

  it("says when the api refuses", async () => {
    const { wrapper } = await mountAt("/save?url=https://example.com/d", {
      ...routes,
      "POST /links": () => ApiTesting.json({ _tag: "RateLimited", retryAfterSeconds: 30 }, 429),
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain("Too many saves"));
  });
});
