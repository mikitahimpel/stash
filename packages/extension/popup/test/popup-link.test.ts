import { describe, expect, it } from "@effect/vitest";
import * as Link from "@stash/contracts-domain/link";
import * as Schema from "effect/Schema";
import * as PopupLink from "../src/popup-link.ts";
import * as PopupApi from "./popup-api.ts";

const decode = Schema.decodeUnknownSync(Link.Link);

describe("PopupLink", () => {
  it("turns a link into plain values", () => {
    const link = decode(
      PopupApi.link("a", {
        url: "https://www.example.com/watch?v=1",
        imageUrl: "https://example.com/a.jpg",
        tags: ["video"],
        enrichedAt: "2026-01-01T00:01:00.000Z",
      }),
    );
    expect(PopupLink.fromLink(link)).toEqual({
      id: "a",
      url: "https://www.example.com/watch?v=1",
      title: "Link a",
      host: "example.com",
      imageUrl: "https://example.com/a.jpg",
      tags: ["video"],
      savedAt: Date.UTC(2026, 0, 1),
      enriched: true,
    });
  });

  it("falls back to the host for a link without a title", () => {
    const link = PopupLink.fromLink(decode(PopupApi.link("b", { title: null })));
    expect(link.title).toBe("example.com");
    expect(link.enriched).toBe(false);
  });

  it("gives the host of a URL, or the text when it is none", () => {
    expect(PopupLink.host("https://www.example.com:8080/a")).toBe("example.com");
    expect(PopupLink.host("not a url")).toBe("not a url");
  });

  it("tells the age in one short unit", () => {
    const minute = 60_000;
    const day = 24 * 60 * minute;
    const at = (elapsed: number) => PopupLink.age(0, elapsed);
    expect(at(-5)).toBe("now");
    expect(at(59_000)).toBe("now");
    expect(at(5 * minute)).toBe("5m");
    expect(at(3 * 60 * minute)).toBe("3h");
    expect(at(2 * day)).toBe("2d");
    expect(at(13 * day)).toBe("13d");
    expect(at(6 * 7 * day)).toBe("6w");
    expect(at(800 * day)).toBe("2y");
  });
});
