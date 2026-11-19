import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MediaFit from "../src/media-fit/media-fit.vue";
import * as MediaShape from "../src/media-fit/media-shape";
import MediaHero from "../src/media-hero/media-hero.vue";
import MediaThumb from "../src/media-row/media-thumb.vue";

const src = "https://example.com/previews/shapes/portrait.svg";

/** The picture finishes loading at this size. */
const load = async (wrapper: ReturnType<typeof mount>, width: number, height: number) => {
  const image = wrapper.find("[data-slot=media-fit-image]");
  Object.defineProperty(image.element, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(image.element, "naturalHeight", { value: height, configurable: true });
  await image.trigger("load");
};

describe("MediaShape", () => {
  it("reads a ratio only from a real size", () => {
    expect(MediaShape.ratio(1600, 900)).toBeCloseTo(16 / 9);
    expect(MediaShape.ratio(null, 900)).toBeUndefined();
    expect(MediaShape.ratio(1600, undefined)).toBeUndefined();
    expect(MediaShape.ratio(0, 900)).toBeUndefined();
    expect(MediaShape.ratio(1600, Number.NaN)).toBeUndefined();
  });

  it("fills a 16:9 box with media close to it and shows the rest whole", () => {
    expect(MediaShape.fit(16 / 9)).toBe("cover");
    expect(MediaShape.fit(1.91)).toBe("cover");
    expect(MediaShape.fit(4 / 3)).toBe("cover");
    expect(MediaShape.fit(1.3)).toBe("cover");
    expect(MediaShape.fit(2.1)).toBe("cover");
    expect(MediaShape.fit(9 / 16)).toBe("contain");
    expect(MediaShape.fit(1)).toBe("contain");
    expect(MediaShape.fit(1.29)).toBe("contain");
    expect(MediaShape.fit(3)).toBe("contain");
  });

  it("scales the limits to a box of another shape", () => {
    expect(MediaShape.fit(9 / 16, 9 / 16)).toBe("cover");
    expect(MediaShape.fit(16 / 9, 9 / 16)).toBe("contain");
  });

  it("reserves a box of the media's shape, 16:9 when unknown and 3:1 at the widest", () => {
    expect(MediaShape.box(undefined)).toBeCloseTo(16 / 9);
    expect(MediaShape.box(9 / 16)).toBeCloseTo(9 / 16);
    expect(MediaShape.box(5)).toBe(3);
  });
});

describe("MediaFit", () => {
  it("fills the box and anchors the crop to the upper third until the shape says otherwise", () => {
    const fit = mount(MediaFit, { props: { src } });
    expect(fit.attributes("data-fit")).toBe("cover");
    expect(fit.find("[data-slot=media-fit-backdrop]").exists()).toBe(false);
    const image = fit.find("[data-slot=media-fit-image]");
    expect(image.classes()).toEqual(expect.arrayContaining(["object-cover", "object-[50%_30%]"]));
    expect(image.attributes()).toMatchObject({
      loading: "lazy",
      referrerpolicy: "no-referrer",
      alt: "",
    });
  });

  it("shows media of a known other shape whole, over a blurred copy, before anything loads", () => {
    const fit = mount(MediaFit, { props: { src, aspect: 9 / 16 } });
    expect(fit.attributes("data-fit")).toBe("contain");
    const backdrop = fit.find("[data-slot=media-fit-backdrop]");
    expect(backdrop.attributes()).toMatchObject({ src, referrerpolicy: "no-referrer" });
    expect(backdrop.classes()).toContain("media-backdrop");
    const frame = fit.find("[data-slot=media-fit-frame]").attributes("style");
    expect(frame).toContain("aspect-ratio: 0.5625");
  });

  it("keeps a known shape close to the box filled", () => {
    for (const aspect of [16 / 9, 4 / 3, 2]) {
      expect(mount(MediaFit, { props: { src, aspect } }).attributes("data-fit")).toBe("cover");
    }
  });

  it("measures an unknown shape when the picture has loaded, in the same <img>", async () => {
    const fit = mount(MediaFit, { props: { src } });
    const image = fit.find("[data-slot=media-fit-image]").element;
    await load(fit, 1600, 900);
    expect(fit.attributes("data-fit")).toBe("cover");
    await load(fit, 900, 1600);
    expect(fit.attributes("data-fit")).toBe("contain");
    expect(fit.find("[data-slot=media-fit-backdrop]").exists()).toBe(true);
    // The picture is not asked for again.
    expect(fit.find("[data-slot=media-fit-image]").element).toBe(image);

    // Another picture is measured anew.
    await fit.setProps({ src: "https://example.com/previews/shapes/wide.svg" });
    expect(fit.attributes("data-fit")).toBe("cover");
  });

  it("obeys a fixed fit: a grid cell always fills, a capped box always shows the whole", async () => {
    const cell = mount(MediaFit, { props: { src, aspect: 9 / 16, fit: "cover" } });
    expect(cell.attributes("data-fit")).toBe("cover");
    const capped = mount(MediaFit, { props: { src, aspect: 16 / 9, fit: "contain" } });
    expect(capped.attributes("data-fit")).toBe("contain");
    // Without a shape there is nothing to frame yet.
    const unknown = mount(MediaFit, { props: { src, fit: "contain" } });
    expect(unknown.attributes("data-fit")).toBe("cover");
    await load(unknown, 1000, 1000);
    expect(unknown.attributes("data-fit")).toBe("contain");
  });

  it("reports a picture that fails and draws its slot in the frame", async () => {
    const fit = mount(MediaFit, {
      props: { src, aspect: 9 / 16 },
      slots: { default: "<i data-player />" },
    });
    expect(fit.find("[data-slot=media-fit-frame] [data-player]").exists()).toBe(true);
    await fit.find("[data-slot=media-fit-image]").trigger("error");
    expect(fit.emitted("error")).toHaveLength(1);
    // With no picture the frame is still there, for the slot.
    const empty = mount(MediaFit, { props: { aspect: 9 / 16 }, slots: { default: "<i />" } });
    expect(empty.find("img").exists()).toBe(false);
    expect(empty.find("[data-slot=media-fit-frame] i").exists()).toBe(true);
  });
});

describe("MediaThumb shapes", () => {
  it("letterboxes a portrait, a square and a panorama, and fills with the rest", () => {
    const fit = (aspect: number) =>
      mount(MediaThumb, { props: { src, aspect } })
        .find("[data-slot=media-fit]")
        .attributes("data-fit");
    expect(fit(9 / 16)).toBe("contain");
    expect(fit(1)).toBe("contain");
    expect(fit(3)).toBe("contain");
    expect(fit(16 / 9)).toBe("cover");
    expect(fit(4 / 3)).toBe("cover");
  });

  it("keeps its 16:9 box whatever the picture is", async () => {
    const thumb = mount(MediaThumb, { props: { src } });
    const box = thumb.classes().join(" ");
    await load(thumb, 900, 1600);
    expect(thumb.find("[data-slot=media-fit]").attributes("data-fit")).toBe("contain");
    expect(thumb.classes().join(" ")).toBe(box);
    expect(thumb.attributes("style")).toBeUndefined();
  });
});

describe("MediaHero shapes", () => {
  const embed = "https://www.youtube-nocookie.com/embed/synthetic01?autoplay=1";

  it("reserves a 16:9 box with a capped height, and letterboxes a tall picture inside it", async () => {
    const hero = mount(MediaHero, { props: { src } });
    expect(hero.attributes("style")).toContain("aspect-ratio: 1.77");
    expect(hero.attributes("style")).toContain("max-height: min(70vh, 640px)");
    const style = hero.attributes("style");
    await load(hero, 900, 1600);
    expect(hero.find("[data-slot=media-fit]").attributes("data-fit")).toBe("contain");
    // The box did not change: nothing on the page moves.
    expect(hero.attributes("style")).toBe(style);
  });

  it("gives a vertical video a 9:16 player in the middle, over the blurred poster", async () => {
    const hero = mount(MediaHero, { props: { src, embed, aspect: 9 / 16, title: "A short" } });
    expect(hero.attributes("style")).toContain("aspect-ratio: 0.5625");
    expect(hero.attributes("style")).toContain("max-height: min(70vh, 640px)");
    const frame = () => hero.find("[data-slot=media-fit-frame]");
    expect(frame().attributes("style")).toContain("aspect-ratio: 0.5625");
    expect(hero.find("[data-slot=media-fit-backdrop]").exists()).toBe(true);

    await hero.find("[data-slot=media-hero-play]").trigger("click");
    expect(frame().find("[data-slot=media-hero-player]").attributes("src")).toBe(embed);
    expect(hero.find("[data-slot=media-fit-backdrop]").exists()).toBe(true);
  });

  it("drops the picture under a player of the box's own shape", async () => {
    const hero = mount(MediaHero, { props: { src, embed } });
    await hero.find("[data-slot=media-hero-play]").trigger("click");
    expect(hero.find("[data-slot=media-hero-player]").exists()).toBe(true);
    expect(hero.find("img").exists()).toBe(false);
  });
});
