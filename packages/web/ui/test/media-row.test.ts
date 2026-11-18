import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MediaRowTitle from "../src/media-row/media-row-title.vue";
import MediaRow from "../src/media-row/media-row.vue";
import MediaThumb from "../src/media-row/media-thumb.vue";

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
