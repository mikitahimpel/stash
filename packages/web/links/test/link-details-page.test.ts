import { DOMWrapper, enableAutoUnmount } from "@vue/test-utils";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Fixtures from "./fixtures.ts";
import { mountAt, settle } from "./mount-page.ts";

enableAutoUnmount(afterEach);

const devices = [
  { id: "device-1", name: "Laptop", kind: "zen", createdAt: "2026-01-01T00:00:00.000Z" },
];

// A synthetic video id: eleven characters, like a real one.
const video = Fixtures.link("v", {
  url: "https://www.youtube.com/watch?v=synthetic01",
  title: "A synthetic talk",
  type: "video",
  status: "seen",
  author: "Example Channel",
  imageUrl: "https://example.com/previews/talk.svg",
  sourceDeviceId: "device-1",
});

describe("link details page", () => {
  const routes: ApiTesting.Routes = {
    "GET /links/:id": (_, { id = "" }) =>
      id === "a"
        ? ApiTesting.json(
            Fixtures.link("a", {
              tags: ["economics", "video"],
              canonicalUrl: "https://example.com/articles/a-canonical",
            }),
          )
        : id === "v"
          ? ApiTesting.json(video)
          : id === "v-bare"
            ? ApiTesting.json({ ...video, id: "v-bare", imageUrl: null })
            : id === "bare"
              ? ApiTesting.json(Fixtures.link("bare", { summary: null, tags: [], type: null }))
              : ApiTesting.json({ _tag: "NotFound", resource: "link", id }, 404),
    "GET /links": () => Fixtures.page([]),
    "GET /devices": () => ApiTesting.json(devices),
    "DELETE /links/:id": () => new Response(null, { status: 204 }),
  };

  it("shows the link: title, summary, tags as filters, type and status apart", async () => {
    const { wrapper } = await mountAt("/links/a", routes);

    expect(wrapper.find("h1").text()).toBe("Example article a");
    expect(wrapper.find("[data-slot=link-summary]").text()).toBe("A summary of article a.");
    expect(wrapper.find("[data-slot=link-kind]").text()).toBe("Article · New");
    const tags = wrapper.findAll("[data-slot=tag-chip]");
    expect(tags.map((tag) => tag.text())).toEqual(["#economics", "#video"]);
    expect(tags[0]!.attributes("href")).toBe("/links?tag=economics");
    // The cover stands in for the missing image, and nothing offers to play an article.
    expect(wrapper.find("[data-slot=media-hero]").attributes("data-cover")).toBe("");
    expect(wrapper.find("[data-slot=media-hero-play]").exists()).toBe(false);
  });

  it("shows a YouTube video's own thumbnail when the link has no image", async () => {
    const { wrapper } = await mountAt("/links/v-bare", routes);

    const hero = wrapper.find("[data-slot=media-hero]");
    expect(hero.find("img").attributes("src")).toBe(
      "https://i.ytimg.com/vi/synthetic01/hqdefault.jpg",
    );
    expect(hero.attributes("data-cover")).toBeUndefined();
  });

  it("opens the link in a new tab from the primary button", async () => {
    const { wrapper } = await mountAt("/links/a", routes);

    const open = wrapper.find("[data-action=open]");
    expect(open.attributes("href")).toBe("https://www.example.com/articles/a");
    expect(open.attributes("target")).toBe("_blank");
    expect(open.attributes("rel")).toBe("noopener noreferrer");
  });

  it("puts host, channel, age and device on one meta line", async () => {
    const { wrapper } = await mountAt("/links/v", routes);

    const meta = wrapper.find("[data-slot=meta-line]");
    expect(meta.findAll(":scope > *").map((item) => item.text())).toEqual([
      "youtube.com",
      "Example Channel",
      expect.stringMatching(/^saved \d+(mo|y) ago$/),
      "Laptop",
    ]);
  });

  it("loads the YouTube player only when play is pressed", async () => {
    const { wrapper } = await mountAt("/links/v", routes);

    expect(wrapper.find("iframe").exists()).toBe(false);
    expect(wrapper.find("[data-slot=media-hero] img").attributes("src")).toBe(
      "https://example.com/previews/talk.svg",
    );
    await wrapper.find("[data-slot=media-hero-play]").trigger("click");

    expect(wrapper.find("iframe").attributes("src")).toBe(
      "https://www.youtube-nocookie.com/embed/synthetic01?autoplay=1",
    );
    expect(wrapper.find("[data-slot=media-hero] img").exists()).toBe(false);
  });

  it("leaves out what the link doesn't have", async () => {
    const { wrapper } = await mountAt("/links/bare", routes);

    expect(wrapper.find("[data-slot=link-summary]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=tag-chip]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=link-kind]").text()).toBe("New");
    expect(wrapper.find("[data-slot=link-canonical-url]").exists()).toBe(false);
  });

  it("keeps the dates and URLs under Details, each URL with a copy button", async () => {
    const { wrapper } = await mountAt("/links/a", routes);

    const details = wrapper.find("[data-slot=disclosure]");
    expect(details.attributes("open")).toBeUndefined();
    expect(details.find("[data-slot=link-canonical-url]").text()).toBe(
      "https://example.com/articles/a-canonical",
    );
    const copy = details.find("[data-slot=link-url] [data-action=copy]");
    expect(copy.attributes("aria-label")).toBe("Copy URL");
    await copy.trigger("click");
    await settle();
    expect(copy.attributes("data-state")).toBe("copied");
  });

  it.each([
    ["s", "seen"],
    ["d", "done"],
    ["e", "archived"],
  ])("%s sends PATCH /links/:id with status %s", async (key, status) => {
    const bodies: Array<unknown> = [];
    const { wrapper, press } = await mountAt("/links/a", {
      ...routes,
      "PATCH /links/:id": (request) =>
        Fixtures.body(request).pipe(
          Effect.map((body) => {
            bodies.push(body);
            return ApiTesting.json(Fixtures.link("a", { status }));
          }),
        ),
    });

    expect(wrapper.find(`[data-action=${status}]`).attributes("aria-keyshortcuts")).toBe(
      key.toUpperCase(),
    );
    expect(await press(key)).toBe(true);
    expect(bodies).toEqual([{ status }]);
  });

  it("offers only the status changes that apply", async () => {
    const { wrapper } = await mountAt("/links/v", routes);

    const actions = wrapper.findAll("[data-slot=action-bar] [data-action]");
    expect(actions.map((action) => action.attributes("data-action"))).toEqual(["done", "archived"]);
  });

  it("links back to the Inbox when opened directly", async () => {
    const { wrapper } = await mountAt("/links/a", routes);

    const back = wrapper.find("[data-action=back]");
    expect(back.text()).toBe("Inbox");
    expect(back.attributes("href")).toBe("/links");
  });

  it("says when the link doesn't exist", async () => {
    const { wrapper } = await mountAt("/links/gone", routes);

    expect(wrapper.find("[data-slot=empty-state]").text()).toContain("Link not found");
  });

  it("asks before deleting, then goes back to the feed", async () => {
    const { wrapper, router } = await mountAt("/links/a", routes);

    await wrapper.find("[data-action=delete]").trigger("click");
    await settle();
    expect(router.currentRoute.value.name).toBe("link-details");
    await new DOMWrapper(wrapper.element.ownerDocument.body)
      .find("[data-action=confirm-delete]")
      .trigger("click");
    // The feed page is a lazy route, so the navigation can outlast `settle`.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("links"));
  });
});
