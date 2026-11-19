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

const quoted = Fixtures.quotedPost({
  id: "1700000000000000004",
  url: "https://x.com/example_quoted/status/1700000000000000004",
  author: { name: "Example Quoted", handle: "example_quoted", avatarUrl: null, verified: false },
  text: "The quoted example",
  entities: [],
  counts: null,
});

const posts: Record<string, unknown> = {
  post: Fixtures.postLink("post", { replyTo: "example_reader" }),
  photos: Fixtures.postLink("photos", {
    media: [1, 2, 3, 4].map(Fixtures.photo),
  }),
  video: Fixtures.postLink("video", { media: [Fixtures.video] }),
  quote: Fixtures.postLink("quote", { quoted }),
  long: {
    ...Fixtures.postLink("long", { long: true }),
    summary: "A written summary of the long post.",
  },
  "gone-post": Fixtures.link("gone-post", {
    url: "https://x.com/example_writer/status/1700000000000000009",
    title: null,
    summary: null,
    type: null,
    post: {
      state: "unavailable",
      id: "1700000000000000009",
      url: "https://x.com/example_writer/status/1700000000000000009",
    },
  }),
};

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
            : id === "short"
              ? ApiTesting.json({
                  ...video,
                  id: "short",
                  url: "https://www.youtube.com/shorts/synthetic01",
                })
              : id === "bare"
                ? ApiTesting.json(Fixtures.link("bare", { summary: null, tags: [], type: null }))
                : id in posts
                  ? ApiTesting.json(posts[id])
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

  it("gives a YouTube Short a vertical player in a box no taller than the screen allows", async () => {
    const { wrapper } = await mountAt("/links/short", routes);

    const hero = wrapper.find("[data-slot=media-hero]");
    expect(hero.attributes("style")).toContain("aspect-ratio: 0.5625");
    expect(hero.attributes("style")).toContain("max-height: min(70vh, 640px)");
    expect(hero.find("[data-slot=media-fit]").attributes("data-fit")).toBe("contain");
    await hero.find("[data-slot=media-hero-play]").trigger("click");
    expect(hero.find("[data-slot=media-fit-frame] [data-slot=media-hero-player]").exists()).toBe(
      true,
    );
    // A video of the usual shape keeps the 16:9 box.
    const usual = await mountAt("/links/v", routes);
    expect(usual.wrapper.find("[data-slot=media-hero]").attributes("style")).toContain(
      "aspect-ratio: 1.77",
    );
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

  describe("a post on X", () => {
    it("shows the post as a card: author, date, words with their links, and quiet counts", async () => {
      const { wrapper } = await mountAt("/links/post", routes);
      const card = wrapper.find("[data-slot=post]");

      expect(card.find("[data-slot=post-author-name]").text()).toBe("Example Writer");
      expect(card.find("[data-slot=post-author-handle]").text()).toBe("@example_writer");
      expect(card.find("[data-slot=post-verified]").exists()).toBe(true);
      expect(card.find("[data-slot=post-byline] a").attributes("href")).toBe(
        "https://x.com/example_writer",
      );
      expect(card.find("[data-slot=post-day]").text()).toBe("Jan 2, 2026");
      expect(card.find("[data-slot=post-reply-to]").text()).toBe("Replying to @example_reader");
      const picture = card.find("[data-slot=avatar] img");
      expect(picture.attributes("referrerpolicy")).toBe("no-referrer");
      expect(picture.attributes("loading")).toBe("lazy");

      // The words keep their line break; links, mentions and hashtags open on their own.
      const words = card.find("[data-slot=post-text]");
      expect(words.text()).toBe(
        "An example post about tiny parsers,\nsee example.com/parsers by @example_reader #parsing",
      );
      const entities = words.findAll("[data-slot=post-entity]");
      expect(entities.map((entity) => [entity.text(), entity.attributes("href")])).toEqual([
        ["example.com/parsers", "https://example.com/parsers?from=post"],
        ["@example_reader", "https://x.com/example_reader"],
        ["#parsing", "https://x.com/hashtag/parsing"],
      ]);
      for (const entity of entities) {
        expect(entity.attributes("target")).toBe("_blank");
        expect(entity.attributes("rel")).toBe("noopener noreferrer");
      }
      expect(card.find("[data-slot=post-facts]").text()).toMatch(
        /· Jan 2, 2026.*56 replies.*1\.2K likes$/,
      );

      // The post stands in for the preview and the visible title; the kind says what it is.
      expect(wrapper.find("[data-slot=media-hero]").exists()).toBe(false);
      expect(wrapper.find("h1").classes()).toContain("sr-only");
      expect(wrapper.find("[data-slot=link-kind]").text()).toBe("Post · New");
      // Its words are above already: no second copy as a summary.
      expect(wrapper.find("[data-slot=link-summary]").exists()).toBe(false);
    });

    it("opens the post on X as the primary action, and copies its text", async () => {
      const { wrapper } = await mountAt("/links/post", routes);
      const open = wrapper.find("[data-action=open]");
      expect(open.text()).toBe("Open on X");
      expect(open.attributes("href")).toBe(
        "https://x.com/example_writer/status/1700000000000000001",
      );

      const copy = wrapper.find("[data-action=copy]");
      expect(copy.text()).toBe("Copy text");
      await copy.trigger("click");
      await settle();
      expect(copy.text()).toBe("Copied");
      expect(copy.attributes("data-state")).toBe("copied");
    });

    it("shows up to four photos as a grid, and opens one large", async () => {
      const { wrapper } = await mountAt("/links/photos", routes);
      const grid = wrapper.find("[data-slot=post-media]");
      expect(grid.attributes("data-count")).toBe("4");
      const photos = grid.findAll("[data-slot=post-photo]");
      expect(photos.map((photo) => photo.attributes("aria-label"))).toEqual([
        "Open photo 1 of 4",
        "Open photo 2 of 4",
        "Open photo 3 of 4",
        "Open photo 4 of 4",
      ]);
      const image = photos[1]!.find("img");
      expect(image.attributes("src")).toBe(
        "https://pbs.twimg.com/media/Synthetic2.jpg?name=medium",
      );
      expect(image.attributes("referrerpolicy")).toBe("no-referrer");
      expect(image.attributes("loading")).toBe("lazy");

      await photos[1]!.trigger("click");
      await settle();
      const page = new DOMWrapper(wrapper.element.ownerDocument.body);
      const large = page.find("[data-slot=post-lightbox-photo]");
      expect(large.attributes("src")).toBe("https://pbs.twimg.com/media/Synthetic2.jpg?name=large");
      expect(large.attributes("referrerpolicy")).toBe("no-referrer");
      expect(page.find("[data-slot=post-lightbox-count]").text()).toBe("2 / 4");

      await page.find("[data-slot=post-lightbox-next]").trigger("click");
      expect(page.find("[data-slot=post-lightbox-photo]").attributes("src")).toContain(
        "Synthetic3",
      );
      await page.find("[data-slot=post-lightbox-close]").trigger("click");
      await settle();
      expect(page.find("[data-slot=post-lightbox-photo]").exists()).toBe(false);
    });

    it("plays a video in place, and loads nothing of it before the press", async () => {
      const { wrapper } = await mountAt("/links/video", routes);
      const video = wrapper.find("[data-slot=post-video]");
      expect(video.find("iframe").exists()).toBe(false);
      const poster = video.find("img");
      expect(poster.attributes("src")).toBe(Fixtures.video.posterUrl);
      expect(poster.attributes("referrerpolicy")).toBe("no-referrer");

      await video.find("[data-slot=post-video-play]").trigger("click");
      const player = video.find("[data-slot=post-video-player]");
      // The player's own document loads the mp4 without a referrer.
      expect(player.attributes("srcdoc")).toContain('<meta name="referrer" content="no-referrer">');
      expect(player.attributes("srcdoc")).toContain(
        'src="https://video.twimg.com/ext_tw_video/1700000000000000002/pu/vid/1280x720/c.mp4?tag=12"',
      );
      expect(video.find("[data-slot=post-video-play]").exists()).toBe(false);
    });

    it("nests the quoted post as a card of its own", async () => {
      const { wrapper } = await mountAt("/links/quote", routes);
      const nested = wrapper.find("[data-slot=post] [data-slot=post-quoted]");
      expect(nested.attributes("data-nested")).toBe("");
      expect(nested.find("[data-slot=post-author-name]").text()).toBe("Example Quoted");
      expect(nested.find("[data-slot=post-author-handle]").text()).toBe("@example_quoted");
      expect(nested.find("[data-slot=post-text]").text()).toBe("The quoted example");
      expect(nested.find("[data-slot=post-byline] a").attributes("href")).toBe(
        "https://x.com/example_quoted/status/1700000000000000004",
      );
    });

    it("says a long post is only its beginning, and shows its written summary", async () => {
      const { wrapper } = await mountAt("/links/long", routes);
      expect(wrapper.find("[data-slot=post-long]").text()).toContain("this is its beginning");
      expect(wrapper.find("[data-slot=link-summary]").text()).toBe(
        "A written summary of the long post.",
      );
    });

    it("says a post is unavailable, and keeps its URL and its actions", async () => {
      const { wrapper } = await mountAt("/links/gone-post", routes);
      const card = wrapper.find("[data-slot=post-unavailable]");
      expect(card.text()).toContain("Post unavailable");
      expect(card.text()).toContain("The link is kept.");
      expect(wrapper.find("[data-slot=post]").exists()).toBe(false);
      expect(wrapper.find("h1").text()).toBe("Post unavailable");
      expect(wrapper.find("[data-slot=link-kind]").text()).toBe("Post · New");
      const open = wrapper.find("[data-action=open]");
      expect(open.text()).toBe("Open on X");
      expect(open.attributes("href")).toBe(
        "https://x.com/example_writer/status/1700000000000000009",
      );
      expect(wrapper.find("[data-action=copy][data-state]").text()).not.toBe("Copy text");
      expect(wrapper.find("[data-slot=link-url]").text()).toContain(
        "https://x.com/example_writer/status/1700000000000000009",
      );
    });
  });
});
