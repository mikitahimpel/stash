import { describe, expect, it } from "@effect/vitest";
import * as ApiToken from "@stash/contracts-domain/api-token";
import * as Device from "@stash/contracts-domain/device";
import * as DateTime from "effect/DateTime";
import * as ConnectStatus from "../src/connect-status.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const id = Device.DeviceId.make;

const device = (
  key: string,
  kind: Device.DeviceKind,
  name = `Synthetic ${key}`,
): Device.Device => ({
  id: id(key),
  name,
  kind,
  createdAt: at("2026-01-01T00:00:00Z"),
});

const activity = (
  key: string,
  lastSeenAt: string | null,
  save?: { at: string; title: string | null; url?: string },
): Device.DeviceActivity => ({
  deviceId: id(key),
  lastSeenAt: lastSeenAt === null ? null : at(lastSeenAt),
  lastSave:
    save === undefined
      ? null
      : {
          at: at(save.at),
          linkId: `link-${key}`,
          url: save.url ?? "https://example.com/a",
          title: save.title,
        },
});

const claudeToken = (lastUsedAt: string | null, revokedAt: string | null = null) => ({
  id: ApiToken.ApiTokenId.make(`token-${lastUsedAt}`),
  deviceId: null,
  name: ApiToken.mcpTokenName,
  createdAt: at("2026-01-01T00:00:00Z"),
  revokedAt: revokedAt === null ? null : at(revokedAt),
  lastUsedAt: lastUsedAt === null ? null : at(lastUsedAt),
});

const empty: ConnectStatus.Snapshot = { devices: [], activity: [], tokens: [] };

describe("Connect status", () => {
  it("says not connected with nothing set up", () => {
    for (const source of ConnectStatus.sources) {
      expect(ConnectStatus.status(source, empty)).toEqual({ _tag: "NotConnected" });
    }
  });

  it("reports the latest save of the extension, with its device", () => {
    const snapshot: ConnectStatus.Snapshot = {
      devices: [device("zen-a", "zen", "Work Zen"), device("zen-b", "zen", "Home Zen")],
      activity: [
        activity("zen-a", "2026-02-01T10:00:00Z", { at: "2026-02-01T09:00:00Z", title: "Older" }),
        activity("zen-b", "2026-02-01T08:00:00Z", { at: "2026-02-01T08:00:00Z", title: null }),
      ],
      tokens: [],
    };
    expect(ConnectStatus.status("extension", snapshot)).toEqual({
      _tag: "Connected",
      at: at("2026-02-01T10:00:00Z"),
      lastSave: { title: "Older", at: at("2026-02-01T09:00:00Z"), deviceName: "Work Zen" },
    });
  });

  it("counts an iPhone only once it saved a link: the Mac agent registers iPhones for tabs", () => {
    const tabsOnly: ConnectStatus.Snapshot = {
      devices: [device("iphone", "ios"), device("mac", "mac-agent")],
      activity: [
        activity("iphone", "2026-02-01T10:00:00Z"),
        activity("mac", "2026-02-01T10:00:00Z"),
      ],
      tokens: [],
    };
    expect(ConnectStatus.status("iphone", tabsOnly)._tag).toBe("NotConnected");
    expect(ConnectStatus.status("mac", tabsOnly)._tag).toBe("Connected");

    const saved = {
      ...tabsOnly,
      activity: [
        activity("iphone", "2026-02-01T11:00:00Z", {
          at: "2026-02-01T11:00:00Z",
          title: null,
          url: "https://example.com/video",
        }),
      ],
    };
    expect(ConnectStatus.status("iphone", saved)).toMatchObject({
      _tag: "Connected",
      lastSave: { title: "example.com" },
    });
  });

  it("connects Claude once its token is used, ignoring revoked tokens", () => {
    expect(ConnectStatus.status("claude", { ...empty, tokens: [claudeToken(null)] })._tag).toBe(
      "NotConnected",
    );
    expect(
      ConnectStatus.status("claude", {
        ...empty,
        tokens: [claudeToken("2026-02-01T00:00:00Z", "2026-02-02T00:00:00Z")],
      })._tag,
    ).toBe("NotConnected");
    expect(
      ConnectStatus.status("claude", { ...empty, tokens: [claudeToken("2026-02-01T00:00:00Z")] }),
    ).toEqual({ _tag: "Connected", at: at("2026-02-01T00:00:00Z"), lastSave: null });
  });

  it("tells a guide what arrived from its device", () => {
    const awaited = { _tag: "Device", deviceId: id("zen-a") } as const;
    const with_ = (...items: ReadonlyArray<Device.DeviceActivity>) => ({
      ...empty,
      activity: items,
    });
    expect(ConnectStatus.arrival(awaited, with_(activity("zen-a", null)))).toBeUndefined();
    expect(ConnectStatus.arrival(awaited, with_(activity("zen-b", "2026-02-01T00:00:00Z")))).toBe(
      undefined,
    );
    expect(
      ConnectStatus.arrival(awaited, with_(activity("zen-a", "2026-02-01T00:00:00Z"))),
    ).toEqual({ _tag: "Contact" });
    expect(
      ConnectStatus.arrival(
        awaited,
        with_(
          activity("zen-a", "2026-02-01T00:00:00Z", {
            at: "2026-02-01T00:00:00Z",
            title: "A synthetic save",
          }),
        ),
      ),
    ).toEqual({ _tag: "Link", title: "A synthetic save" });
  });

  it("waits for Claude's use after the guide started", () => {
    const awaited = { _tag: "Claude", since: at("2026-02-01T12:00:00Z") } as const;
    expect(
      ConnectStatus.arrival(awaited, { ...empty, tokens: [claudeToken("2026-02-01T11:00:00Z")] }),
    ).toBeUndefined();
    expect(
      ConnectStatus.arrival(awaited, { ...empty, tokens: [claudeToken("2026-02-01T12:00:30Z")] }),
    ).toEqual({ _tag: "Claude" });
  });
});
