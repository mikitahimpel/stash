import * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import * as LinkDays from "../src/list/link-days.ts";
import * as Fixtures from "./fixtures.ts";

const decode = Schema.decodeUnknownSync(Link.Link);
const at = (id: string, createdAt: string): Link.Link => decode(Fixtures.link(id, { createdAt }));

const utc = DateTime.zoneMakeNamedUnsafe("UTC");
const now = DateTime.makeUnsafe("2026-10-27T10:00:00.000Z");

describe("groupByDay", () => {
  it("groups newest-first links by day as Today, Yesterday and dates", () => {
    const groups = LinkDays.groupByDay(
      [
        at("a", "2026-10-27T09:00:00.000Z"),
        at("b", "2026-10-27T00:00:00.000Z"),
        at("c", "2026-10-26T23:59:59.000Z"),
        at("d", "2026-10-20T08:00:00.000Z"),
        at("e", "2025-12-31T08:00:00.000Z"),
      ],
      now,
      utc,
    );
    expect(groups.map((group) => [group.label, group.links.map((link) => link.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
      ["Tue, Oct 20", ["d"]],
      ["Wed, Dec 31, 2025", ["e"]],
    ]);
  });

  it("splits days in the given time zone", () => {
    const tokyo = DateTime.zoneMakeNamedUnsafe("Asia/Tokyo");
    // 23:30 UTC on the 26th is already the 27th in Tokyo.
    const groups = LinkDays.groupByDay([at("a", "2026-10-26T23:30:00.000Z")], now, tokyo);
    expect(groups.map((group) => group.label)).toEqual(["Today"]);
  });

  it("returns no groups for no links", () => {
    expect(LinkDays.groupByDay([], now, utc)).toEqual([]);
  });
});
