import { DOMWrapper, enableAutoUnmount } from "@vue/test-utils";
import * as ApiTesting from "@stash/web-api-client/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Fixtures from "./fixtures.ts";
import { mountAt, settle } from "./mount-page.ts";

// The in-memory history keeps no `state.back`, so the page is told it was opened from the Inbox.
vi.mock("../src/details/link-back.ts", () => ({
  from: () => ({ label: "Inbox", history: true }),
}));

enableAutoUnmount(afterEach);

describe("link details page, opened from the Inbox", () => {
  const routes: ApiTesting.Routes = {
    "GET /links/:id": () => ApiTesting.json(Fixtures.link("a")),
    "GET /links": () => Fixtures.page([]),
    "GET /devices": () => ApiTesting.json([]),
    "DELETE /links/:id": () => new Response(null, { status: 204 }),
  };

  it("goes back to the Inbox with its filters after a delete", async () => {
    const { wrapper, router } = await mountAt("/links?feed=all&tag=economics", routes);
    await router.push("/links/a");
    await settle();

    await wrapper.find("[data-action=delete]").trigger("click");
    await settle();
    await new DOMWrapper(wrapper.element.ownerDocument.body)
      .find("[data-action=confirm-delete]")
      .trigger("click");
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe("/links?feed=all&tag=economics"),
    );
  });
});
