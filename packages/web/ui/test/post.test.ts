import { DOMWrapper, enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import Avatar from "../src/avatar/avatar.vue";
import MediaRowTitle from "../src/media-row/media-row-title.vue";
import MediaRow from "../src/media-row/media-row.vue";
import MediaThumb from "../src/media-row/media-thumb.vue";
import PostByline from "../src/post/post-byline.vue";
import * as PostMediaItems from "../src/post/post-media";
import PostMedia from "../src/post/post-media.vue";
import * as PostTextParts from "../src/post/post-text";
import PostText from "../src/post/post-text.vue";

enableAutoUnmount(afterEach);

const photo = (n: number, width = 1200, height = 800): PostMediaItems.Photo => ({
  kind: "photo",
  url: `https://example.com/previews/photo-${n}.svg`,
  fullUrl: `https://example.com/previews/photo-${n}-large.svg`,
  width,
  height,
});

const video: PostMediaItems.Video = {
  kind: "video",
  posterUrl: "https://example.com/previews/poster.svg",
  videoUrl: 'https://example.com/video.mp4?a=1&b="2"',
  width: 1920,
  height: 1080,
};

describe("Avatar", () => {
  it("loads the picture lazily and without a referrer, and falls back to the initial", async () => {
    const avatar = mount(Avatar, {
      props: { src: "https://example.com/previews/avatar.svg", name: "Example Writer" },
    });
    const img = avatar.find("img");
    expect(img.attributes("loading")).toBe("lazy");
    expect(img.attributes("referrerpolicy")).toBe("no-referrer");
    expect(img.attributes("alt")).toBe("");

    await img.trigger("error");
    expect(avatar.find("img").exists()).toBe(false);
    expect(avatar.text()).toBe("E");
    expect(mount(Avatar, { props: { src: null, name: " 🙂 smile" } }).text()).toBe("🙂");
  });
});

describe("MediaRow for a post", () => {
  it("puts the meta line first and gives the title its two lines, in the same grid", () => {
    const row = mount(MediaRow, {
      props: { metaFirst: true },
      slots: { title: "<a>Words</a>", meta: "<span>Author</span>", tags: "<span>#tag</span>" },
    });
    expect(row.attributes("data-meta-first")).toBe("");
    expect(row.classes()).toContain("sm:grid-rows-[20px_20px_20px_24px]");
    expect(row.find("[data-slot=media-row-meta]").classes()).toContain("row-start-1");
    const title = row.find("[data-slot=media-row-title-line]");
    expect(title.classes()).toEqual(
      expect.arrayContaining(["row-start-2", "sm:row-span-2", "sm:h-10"]),
    );
    // The title's two lines stand where the summary line would.
    expect(row.find("[data-slot=media-row-summary]").exists()).toBe(false);
  });

  it("clamps a two-line title at every width, as running text", () => {
    const two = mount(MediaRowTitle, { props: { lines: 2 }, slots: { default: "Words" } });
    expect(two.classes()).toEqual(expect.arrayContaining(["line-clamp-2", "text-body"]));
    expect(two.classes()).not.toContain("sm:line-clamp-1");
    const one = mount(MediaRowTitle, { slots: { default: "A title" } });
    expect(one.classes()).toEqual(expect.arrayContaining(["text-row-title", "sm:line-clamp-1"]));
  });

  it("shows a person's picture on the generated cover instead of the favicon", () => {
    const thumb = mount(MediaThumb, {
      props: {
        url: "https://x.com/example_writer/status/1",
        avatar: { src: "https://example.com/previews/avatar.svg", name: "Example Writer" },
      },
    });
    expect(thumb.attributes("data-cover")).toBe("");
    expect(thumb.find("[data-slot=media-cover-avatar] img").attributes("src")).toBe(
      "https://example.com/previews/avatar.svg",
    );
    expect(thumb.find("[data-slot=media-cover-icon]").exists()).toBe(false);
    // With an image of its own the row shows that.
    const image = mount(MediaThumb, {
      props: { src: "https://example.com/og.png", avatar: { src: null, name: "E" } },
    });
    expect(image.find("[data-slot=media-cover-avatar]").exists()).toBe(false);
  });
});

describe("PostByline", () => {
  it("is one line in a row, and links to the profile in a card", () => {
    const row = mount(PostByline, {
      props: { name: "Example Writer", handle: "example_writer", verified: true, size: "row" },
    });
    expect(row.element.tagName).toBe("SPAN");
    // No picture: the initial stands in, and the name and the handle follow on the same line.
    expect(row.text()).toBe("EExample Writer@example_writer");
    expect(row.find("[data-slot=post-verified]").attributes("aria-label")).toBe("Verified");
    expect(row.find("a").exists()).toBe(false);

    const card = mount(PostByline, {
      props: {
        name: "Example Writer",
        handle: "example_writer",
        href: "https://x.com/example_writer",
      },
      slots: { meta: "<span>Jan 2, 2026</span>" },
    });
    const link = card.find("a");
    expect(link.attributes()).toMatchObject({
      href: "https://x.com/example_writer",
      target: "_blank",
      rel: "noopener noreferrer",
    });
    expect(card.find("[data-slot=post-verified]").exists()).toBe(false);
    expect(card.text()).toContain("Jan 2, 2026");
  });
});

describe("PostText", () => {
  it("cuts a text into plain runs and links, and never shows a part twice", () => {
    const text = "See example.com/a by @writer";
    expect(
      PostTextParts.parts(text, [
        { start: 21, end: 28, url: "https://x.com/writer" },
        { start: 4, end: 17, url: "https://example.com/a" },
        // Overlaps the first link, and one past the end: both stay plain text.
        { start: 10, end: 22, url: "https://example.com/overlap" },
        { start: 25, end: 99, url: "https://example.com/outside" },
      ]),
    ).toEqual([
      { text: "See " },
      { text: "example.com/a", url: "https://example.com/a" },
      { text: " by " },
      { text: "@writer", url: "https://x.com/writer" },
    ]);
    expect(PostTextParts.parts("", [])).toEqual([]);
  });

  it("keeps line breaks and opens links in a new tab without a referrer", () => {
    const words = mount(PostText, {
      props: {
        text: "First line\n<b>not markup</b> example.com/a",
        entities: [{ start: 29, end: 42, url: "https://example.com/a" }],
      },
    });
    expect(words.classes()).toContain("whitespace-pre-wrap");
    expect(words.element.textContent).toBe("First line\n<b>not markup</b> example.com/a");
    expect(words.find("b").exists()).toBe(false);
    expect(words.find("a").attributes()).toMatchObject({
      href: "https://example.com/a",
      target: "_blank",
      rel: "noopener noreferrer",
    });
  });
});

describe("PostMedia", () => {
  it("gives a single photo its own shape within limits, and several one 16:9 box", () => {
    expect(PostMediaItems.ratio(photo(1, 1200, 800))).toBeCloseTo(1.5);
    expect(PostMediaItems.ratio(photo(1, 800, 3200))).toBe(PostMediaItems.minRatio);
    expect(PostMediaItems.ratio(photo(1, 4000, 500))).toBe(PostMediaItems.maxRatio);
    expect(PostMediaItems.ratio({ ...photo(1), width: null })).toBeCloseTo(16 / 9);

    const one = mount(PostMedia, { props: { media: [photo(1, 800, 3200)] } });
    expect(one.attributes("data-count")).toBe("1");
    expect(one.attributes("style")).toContain("aspect-ratio: 0.75");
    // A quoted post's media is never taller than 16:9.
    const compact = mount(PostMedia, { props: { media: [photo(1, 800, 3200)], compact: true } });
    expect(compact.attributes("style")).toContain("aspect-ratio: 1.77");

    const three = mount(PostMedia, { props: { media: [photo(1), photo(2), photo(3)] } });
    expect(three.attributes("style")).toContain("aspect-ratio: 16 / 9");
    expect(three.classes()).toEqual(expect.arrayContaining(["grid-cols-2", "grid-rows-2"]));
    expect(three.findAll(":scope > div")[0]!.classes()).toContain("row-span-2");
  });

  it("shows four at most, and nothing for a post without media", () => {
    const many = mount(PostMedia, { props: { media: [1, 2, 3, 4, 5].map((n) => photo(n)) } });
    expect(many.findAll("[data-slot=post-photo]")).toHaveLength(4);
    expect(
      mount(PostMedia, { props: { media: [] } })
        .find("[data-slot=post-media]")
        .exists(),
    ).toBe(false);
  });

  it("opens a photo large, steps with the arrow keys and closes", async () => {
    const media = mount(PostMedia, {
      props: { media: [photo(1), video, photo(2)] },
      attachTo: "body",
    });
    const page = new DOMWrapper(media.element.ownerDocument.body);
    const photos = media.findAll("[data-slot=post-photo]");
    // The video is not a photo: the lightbox counts two.
    expect(photos.map((item) => item.attributes("aria-label"))).toEqual([
      "Open photo 1 of 2",
      "Open photo 2 of 2",
    ]);
    await photos[1]!.trigger("click");
    const shown = () => page.find("[data-slot=post-lightbox-photo]").attributes("src");
    expect(shown()).toBe("https://example.com/previews/photo-2-large.svg");
    expect(page.find("[data-slot=post-lightbox-photo]").attributes("referrerpolicy")).toBe(
      "no-referrer",
    );

    await page.find("[data-slot=post-lightbox-stage]").trigger("keydown", { key: "ArrowRight" });
    expect(shown()).toBe("https://example.com/previews/photo-1-large.svg");
    await page.find("[data-slot=post-lightbox-previous]").trigger("click");
    expect(shown()).toBe("https://example.com/previews/photo-2-large.svg");
    expect(page.find("[data-slot=post-lightbox-count]").text()).toBe("2 / 2");

    await page.find("[data-slot=post-lightbox-close]").trigger("click");
    expect(page.find("[data-slot=post-lightbox-photo]").exists()).toBe(false);
  });

  it("plays a video in a frame that loads everything without a referrer", async () => {
    const media = mount(PostMedia, { props: { media: [video] } });
    expect(media.find("iframe").exists()).toBe(false);
    expect(media.find("[data-slot=post-video] img").attributes("referrerpolicy")).toBe(
      "no-referrer",
    );
    await media.find("[data-slot=post-video-play]").trigger("click");
    const srcdoc = media.find("[data-slot=post-video-player]").attributes("srcdoc") ?? "";
    expect(srcdoc).toContain('<meta name="referrer" content="no-referrer">');
    // The URL is an attribute value: its quotes and ampersands are escaped.
    expect(srcdoc).toContain('src="https://example.com/video.mp4?a=1&amp;b=&quot;2&quot;"');
    expect(srcdoc).toContain("controls autoplay playsinline>");
  });

  it("loops a GIF silently, and shows a video with no file as its poster alone", async () => {
    expect(PostMediaItems.playerDocument({ ...video, kind: "gif" })).toContain(" loop muted>");
    const still = mount(PostMedia, { props: { media: [{ ...video, videoUrl: null }] } });
    expect(still.find("[data-slot=post-video-play]").exists()).toBe(false);
    expect(still.find("[data-slot=post-video] img").exists()).toBe(true);
    const gif = mount(PostMedia, { props: { media: [{ ...video, kind: "gif" }] } });
    expect(gif.find("[data-slot=post-video-gif]").text()).toBe("GIF");
    expect(gif.find("[data-slot=post-video-play]").attributes("aria-label")).toBe("Play GIF");
  });
});
