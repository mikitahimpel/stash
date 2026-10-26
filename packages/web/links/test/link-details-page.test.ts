import { DOMWrapper, enableAutoUnmount } from "@vue/test-utils";
import * as ApiTesting from "@stash/web-api-client/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Fixtures from "./fixtures.ts";
import { mountAt, settle } from "./mount-page.ts";

enableAutoUnmount(afterEach);

describe("link details page", () => {
  const routes: ApiTesting.Routes = {
    "GET /links/:id": (_, { id = "" }) =>
      id === "a"
        ? ApiTesting.json(Fixtures.link("a", { tags: ["economics", "video"] }))
        : ApiTesting.json({ _tag: "NotFound", resource: "link", id }, 404),
    "GET /links": () => Fixtures.page([]),
    "DELETE /links/:id": () => new Response(null, { status: 204 }),
  };

  it("shows the link", async () => {
    const { wrapper } = await mountAt("/links/a", routes);

    expect(wrapper.find("h1").text()).toBe("Example article a");
    expect(wrapper.text()).toContain("A summary of article a.");
    expect(wrapper.text()).toContain("#economics");
    expect(wrapper.find("a[href='/links?tag=economics']").exists()).toBe(true);
  });

  it("says when the link doesn't exist", async () => {
    const { wrapper } = await mountAt("/links/gone", routes);

    expect(wrapper.find("[data-slot=empty-state]").text()).toContain("Link not found");
  });

  it("goes back to the feed after deleting", async () => {
    const { wrapper, router } = await mountAt("/links/a", routes);

    await wrapper.find("[data-action=delete]").trigger("click");
    await settle();
    await new DOMWrapper(wrapper.element.ownerDocument.body)
      .find("[data-action=confirm-delete]")
      .trigger("click");
    // The feed page is a lazy route, so the navigation can outlast `settle`.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("links"));
  });
});
