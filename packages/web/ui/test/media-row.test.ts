import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
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
  });
});
