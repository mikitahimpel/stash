import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MediaRowTitle from "../src/media-row/media-row-title.vue";
import MediaHero from "../src/media-hero/media-hero.vue";
import MediaRow from "../src/media-row/media-row.vue";
import MediaThumb from "../src/media-row/media-thumb.vue";
import * as SiteCover from "../src/media-row/site-cover";

describe("MediaRow", () => {
  it("shows the unread dot and the action bar only when asked", async () => {
    const wrapper = mount(MediaRow, {
      slots: {
        title: "<a href='https://example.com/'>Example</a>",
        actions: "<button>Archive</button>",
      },
    });
    expect(wrapper.find("[data-slot=media-row-unread]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=media-row-actions]").exists()).toBe(false);

    await wrapper.setProps({ unread: true, selected: true });
    expect(wrapper.find("[data-slot=media-row-unread]").attributes("aria-label")).toBe(
      "Not yet seen",
    );
    expect(wrapper.find("[data-slot=media-row-actions]").text()).toBe("Archive");
  });
});

describe("MediaRow lines", () => {
  it("keeps the summary line when there is no summary, so every row is one height", () => {
    const bare = mount(MediaRow, {
      slots: { title: "<a href='https://example.com/'>Example</a>" },
    });
    expect(bare.find("[data-slot=media-row-summary]").exists()).toBe(true);
    expect(bare.find("[data-slot=media-row-summary]").text()).toBe("");
    // A list without tags (open tabs) has no tags line on a phone.
    expect(bare.find("[data-slot=media-row-tags]").classes()).toContain("max-sm:hidden");

    const full = mount(MediaRow, {
      slots: { title: "<a>Example</a>", summary: "A summary.", tags: "<span>#tag</span>" },
    });
    expect(full.find("[data-slot=media-row-summary]").text()).toBe("A summary.");
    expect(full.find("[data-slot=media-row-tags]").classes()).not.toContain("max-sm:hidden");
  });
});

describe("MediaThumb", () => {
  it("shows the image, or the site's initial when there is none", () => {
    const image = mount(MediaThumb, {
      props: { src: "https://example.com/og.png", initial: "example.com" },
    });
    expect(image.find("img").attributes("src")).toBe("https://example.com/og.png");
    expect(image.attributes("data-empty")).toBeUndefined();

    const empty = mount(MediaThumb, { props: { initial: "example.com", video: true } });
    expect(empty.find("img").exists()).toBe(false);
    expect(empty.text()).toBe("e");
    expect(empty.find("[data-slot=media-thumb-video]").exists()).toBe(true);
    expect(
      mount(MediaThumb, { props: { src: null, initial: "x" } })
        .find("img")
        .exists(),
    ).toBe(false);
  });

  it("loads the image lazily and without a referrer", () => {
    const img = mount(MediaThumb, { props: { src: "https://example.com/og.png" } }).find("img");
    expect(img.attributes("loading")).toBe("lazy");
    expect(img.attributes("referrerpolicy")).toBe("no-referrer");
    expect(img.attributes("alt")).toBe("");
  });

  it("falls back to the initial when the image fails to load, until it gets another", async () => {
    const thumb = mount(MediaThumb, {
      props: { src: "https://example.com/gone.png", initial: "example.com" },
    });
    await thumb.find("img").trigger("error");
    expect(thumb.find("img").exists()).toBe(false);
    expect(thumb.text()).toBe("e");
    expect(thumb.attributes("data-empty")).toBe("");

    await thumb.setProps({ src: "https://example.com/other.png" });
    expect(thumb.find("img").attributes("src")).toBe("https://example.com/other.png");
  });
});

describe("MediaThumb cover", () => {
  const url = "https://www.example.org/articles/1";

  it("covers a link without an image: the site's hue, its favicon and its host", () => {
    const thumb = mount(MediaThumb, { props: { src: null, url } });
    expect(thumb.attributes("data-cover")).toBe("");
    expect(thumb.classes()).toContain("media-cover");
    expect(thumb.attributes("style")).toContain(`--cover-hue: ${SiteCover.hue("example.org")}`);
    const icon = thumb.find("[data-slot=media-cover-icon]");
    expect(icon.attributes()).toMatchObject({
      src: "https://www.example.org/favicon.ico",
      loading: "lazy",
      referrerpolicy: "no-referrer",
      alt: "",
    });
    expect(thumb.find("[data-slot=media-cover-host]").text()).toBe("example.org");
  });

  it("falls back to the initial when the favicon fails, and tries again for another site", async () => {
    const thumb = mount(MediaThumb, { props: { url } });
    await thumb.find("[data-slot=media-cover-icon]").trigger("error");
    expect(thumb.find("img").exists()).toBe(false);
    expect(thumb.find("[data-slot=media-cover-initial]").text()).toBe("e");
    expect(thumb.find("[data-slot=media-cover-host]").text()).toBe("example.org");

    await thumb.setProps({ url: "https://example.net/" });
    expect(thumb.find("[data-slot=media-cover-icon]").attributes("src")).toBe(
      "https://example.net/favicon.ico",
    );
  });

  it("is no cover while the image shows, and comes back when the image fails", async () => {
    const thumb = mount(MediaThumb, { props: { src: "https://example.org/og.png", url } });
    expect(thumb.attributes("data-cover")).toBeUndefined();
    expect(thumb.find("[data-slot=media-cover-icon]").exists()).toBe(false);
    await thumb.find("img").trigger("error");
    expect(thumb.attributes("data-cover")).toBe("");
    expect(thumb.find("[data-slot=media-cover-host]").text()).toBe("example.org");
  });

  it("stays the neutral tile for something that is not a web page", () => {
    const thumb = mount(MediaThumb, { props: { url: "about:blank", initial: "about" } });
    expect(thumb.attributes("data-cover")).toBeUndefined();
    expect(thumb.find("img").exists()).toBe(false);
    expect(thumb.text()).toBe("a");
  });
});

describe("SiteCover", () => {
  it.each([
    ["https://example.com/a/b?c=1", "example.com", "https://example.com/favicon.ico"],
    ["https://www.example.org/", "example.org", "https://www.example.org/favicon.ico"],
    [
      "http://docs.example.net:8080/x",
      "docs.example.net",
      "http://docs.example.net:8080/favicon.ico",
    ],
  ])("reads the host and the favicon of %s", (url, host, icon) => {
    expect(SiteCover.host(url)).toBe(host);
    expect(SiteCover.favicon(url)).toBe(icon);
  });

  it.each([
    "about:blank",
    "file:///home/synthetic/notes.html",
    "moz-extension://abc/page.html",
    "nope",
  ])("has neither for %s, which is not a web page", (url) => {
    expect(SiteCover.host(url)).toBe("");
    expect(SiteCover.favicon(url)).toBeNull();
  });

  it("gives a host one hue for good, and different hosts different hues", () => {
    const hosts = [
      "github.com",
      "huggingface.co",
      "example.com",
      "example.org",
      "docs.example.net",
    ];
    const hues = hosts.map(SiteCover.hue);
    expect(hues).toEqual(hosts.map(SiteCover.hue));
    for (const value of hues) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(360);
    }
    expect(new Set(hues).size).toBe(hosts.length);
  });
});

describe("MediaRowTitle", () => {
  it("covers the whole row unless told not to", () => {
    const covering = mount(MediaRowTitle, { slots: { default: "Example" } });
    expect(covering.classes()).toContain("after:absolute");
    const plain = mount(MediaRowTitle, {
      props: { stretch: false },
      slots: { default: "Example" },
    });
    expect(plain.classes()).not.toContain("after:absolute");
  });
});

describe("MediaHero", () => {
  it("shows the image without a referrer, or the site's cover when there is none", async () => {
    const hero = mount(MediaHero, {
      props: { src: "https://example.com/og.png", url: "https://www.example.com/a" },
    });
    expect(hero.find("img").attributes("src")).toBe("https://example.com/og.png");
    expect(hero.find("img").attributes("referrerpolicy")).toBe("no-referrer");
    expect(hero.attributes("data-cover")).toBeUndefined();

    await hero.find("img").trigger("error");
    expect(hero.attributes("data-cover")).toBe("");
    expect(hero.find("[data-slot=media-cover-icon]").attributes("src")).toBe(
      "https://www.example.com/favicon.ico",
    );
    expect(hero.find("[data-slot=media-cover-host]").text()).toBe("example.com");

    await hero.find("[data-slot=media-cover-icon]").trigger("error");
    expect(hero.find("[data-slot=media-cover-initial]").text()).toBe("e");
  });

  it("has no play button without a player", () => {
    const hero = mount(MediaHero, { props: { src: "https://example.com/og.png" } });
    expect(hero.find("button").exists()).toBe(false);
  });

  it("creates the player only on a press of play, anywhere on the preview", async () => {
    const props = {
      src: "https://example.com/frame.png",
      embed: "https://player.example.com/embed/1",
      title: "A synthetic talk",
    };
    const hero = mount(MediaHero, { props });
    expect(hero.find("iframe").exists()).toBe(false);
    expect(hero.find("button").attributes("aria-label")).toBe("Play A synthetic talk");

    await hero.find("button").trigger("click");
    expect(hero.find("iframe").attributes("src")).toBe("https://player.example.com/embed/1");
    expect(hero.find("iframe").attributes("title")).toBe("A synthetic talk");
    expect(hero.find("button").exists()).toBe(false);

    const other = mount(MediaHero, { props });
    await other.trigger("click");
    expect(other.find("iframe").exists()).toBe(true);

    // Another link's player doesn't start by itself.
    await other.setProps({ embed: "https://player.example.com/embed/2" });
    expect(other.find("iframe").exists()).toBe(false);
  });
});
