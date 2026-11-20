import { describe, expect, it } from "@effect/vitest";
import type * as TabsGroup from "@stash/contracts-api/tabs";
import * as LinkEvent from "@stash/contracts-domain/link-event";
import * as Schema from "effect/Schema";
import * as TabPatches from "../src/tab-patches.ts";

const device = (id: string) => ({
  id,
  name: `Synthetic ${id}`,
  kind: "zen",
  createdAt: "2026-01-01T00:00:00.000Z",
});

const event = (deviceId: string, takenAt: string, urls: ReadonlyArray<string>) =>
  Schema.decodeUnknownSync(LinkEvent.TabsUpdated)({
    type: "tabs.updated",
    at: takenAt,
    device: device(deviceId),
    snapshot: {
      deviceId,
      takenAt,
      tabs: urls.map((url) => ({ url, title: null, openedAt: null, lastSeenAt: takenAt })),
    },
    saved: [],
  });

const answer = (takenAt: string | null): TabsGroup.AllTabs => {
  const a = event("device-a", takenAt ?? "2026-01-01T00:00:00.000Z", ["https://example.com/a"]);
  const b = event("device-b", "2026-01-01T00:00:00.000Z", ["https://example.com/b"]);
  return {
    devices: [
      { device: a.device, snapshot: takenAt === null ? null : a.snapshot, saved: [] },
      { device: b.device, snapshot: b.snapshot, saved: [] },
    ],
  };
};

const patches = (...events: ReadonlyArray<LinkEvent.TabsUpdated>): TabPatches.Patches =>
  new Map(events.map((e) => [e.device.id, e]));

describe("TabPatches.apply", () => {
  it("replaces a device's older snapshot and leaves the others as they are", () => {
    const all = answer("2026-01-01T00:00:00.000Z");
    const next = TabPatches.apply(
      all,
      patches(event("device-a", "2026-01-01T00:01:00.000Z", ["https://example.com/new"])),
    );
    expect(next.devices[0]?.snapshot?.tabs.map((tab) => tab.url)).toEqual([
      "https://example.com/new",
    ]);
    expect(next.devices[1]).toBe(all.devices[1]);
  });

  it("fills a device that had never reported", () => {
    const next = TabPatches.apply(
      answer(null),
      patches(event("device-a", "2026-01-01T00:01:00.000Z", ["https://example.com/new"])),
    );
    expect(next.devices[0]?.snapshot?.tabs).toHaveLength(1);
  });

  it("keeps an answer that is newer than the patch, as the same object", () => {
    const all = answer("2026-01-01T00:05:00.000Z");
    expect(TabPatches.apply(all, patches(event("device-a", "2026-01-01T00:01:00.000Z", [])))).toBe(
      all,
    );
  });

  it("adds a device the answer does not list yet, at the end", () => {
    const next = TabPatches.apply(
      answer("2026-01-01T00:00:00.000Z"),
      patches(event("device-c", "2026-01-01T00:01:00.000Z", ["https://example.com/c"])),
    );
    expect(next.devices.map((entry) => entry.device.id)).toEqual([
      "device-a",
      "device-b",
      "device-c",
    ]);
  });
});
