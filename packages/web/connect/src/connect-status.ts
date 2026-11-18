import * as ApiToken from "@stash/contracts-domain/api-token";
import type * as Device from "@stash/contracts-domain/device";
import * as DateTime from "effect/DateTime";

// What the Connect section of Settings shows for each way into Stash: whether it is connected, and its latest
// activity. Pure, over the api's devices, their activity and the tokens.

/** One row of the Connect section. */
export type Source = "iphone" | "extension" | "mac" | "claude";

export const sources: ReadonlyArray<Source> = ["iphone", "extension", "mac", "claude"];

/** The device kind each device-based source registers. Claude has no device. */
export const deviceKind: Readonly<Record<Exclude<Source, "claude">, Device.DeviceKind>> = {
  iphone: "ios",
  extension: "zen",
  mac: "mac-agent",
};

/** The latest save of a source: which link, when, from which device. */
export interface LastSave {
  readonly title: string;
  readonly at: DateTime.Utc;
  readonly deviceName: string;
}

export type Status =
  | { readonly _tag: "NotConnected" }
  | {
      readonly _tag: "Connected";
      /** When the source was last in touch. */
      readonly at: DateTime.Utc;
      readonly lastSave: LastSave | null;
    };

/** What the api tells about devices and tokens. */
export interface Snapshot {
  readonly devices: ReadonlyArray<Device.Device>;
  readonly activity: ReadonlyArray<Device.DeviceActivity>;
  readonly tokens: ReadonlyArray<ApiToken.ApiTokenInfo>;
}

/** A link's title for a status line: its title, else its host. */
export const linkTitle = (save: Device.DeviceLastSave): string => {
  if (save.title !== null && save.title.trim() !== "") return save.title;
  try {
    return new URL(save.url).host;
  } catch {
    return save.url;
  }
};

const latest = <A>(items: ReadonlyArray<A>, at: (item: A) => DateTime.Utc | null): A | undefined =>
  items.reduce<A | undefined>((best, item) => {
    const time = at(item);
    if (time === null) return best;
    const bestTime = best === undefined ? null : at(best);
    return bestTime === null || DateTime.isGreaterThan(time, bestTime) ? item : best;
  }, undefined);

/** Claude's tokens that still work. */
const claudeTokens = (tokens: ReadonlyArray<ApiToken.ApiTokenInfo>) =>
  tokens.filter((token) => token.name === ApiToken.mcpTokenName && token.revokedAt === null);

/**
 * The status of `source`. iPhone counts only devices that saved a link (the Mac agent also
 * registers iPhones, for their tabs). The extension and the Mac count any contact. Claude is
 * connected once a `Claude (MCP)` token was used.
 */
export const status = (source: Source, snapshot: Snapshot): Status => {
  if (source === "claude") {
    const used = latest(claudeTokens(snapshot.tokens), (token) => token.lastUsedAt ?? null);
    return used?.lastUsedAt == null
      ? { _tag: "NotConnected" }
      : { _tag: "Connected", at: used.lastUsedAt, lastSave: null };
  }
  const kind = deviceKind[source];
  const names = new Map(
    snapshot.devices.filter((device) => device.kind === kind).map((device) => [device.id, device]),
  );
  const ours = snapshot.activity.filter(
    (activity) =>
      names.has(activity.deviceId) && (source !== "iphone" || activity.lastSave !== null),
  );
  const seen = latest(ours, (activity) => activity.lastSeenAt);
  if (seen?.lastSeenAt == null) return { _tag: "NotConnected" };
  const saved = latest(ours, (activity) => activity.lastSave?.at ?? null);
  const lastSave =
    saved?.lastSave == null
      ? null
      : {
          title: linkTitle(saved.lastSave),
          at: saved.lastSave.at,
          deviceName: names.get(saved.deviceId)?.name ?? "",
        };
  return { _tag: "Connected", at: seen.lastSeenAt, lastSave };
};

/** What a guide waits for: a new device's first contact, or Claude's first use after `since`. */
export type Awaited =
  | { readonly _tag: "Device"; readonly deviceId: Device.DeviceId }
  | { readonly _tag: "Claude"; readonly since: DateTime.Utc };

/** What arrived, for "Connected ✓ — … arrived". */
export type Arrival =
  | { readonly _tag: "Link"; readonly title: string }
  | { readonly _tag: "Contact" }
  | { readonly _tag: "Claude" };

/**
 * Whether what the guide waits for has happened. A device's link wins over its plain contact (a
 * tabs snapshot or a token check), so the guide can name the link that arrived.
 */
export const arrival = (awaited: Awaited, snapshot: Snapshot): Arrival | undefined => {
  if (awaited._tag === "Claude") {
    return claudeTokens(snapshot.tokens).some(
      (token) => token.lastUsedAt != null && !DateTime.isLessThan(token.lastUsedAt, awaited.since),
    )
      ? { _tag: "Claude" }
      : undefined;
  }
  const activity = snapshot.activity.find((it) => it.deviceId === awaited.deviceId);
  if (activity === undefined) return undefined;
  if (activity.lastSave !== null) return { _tag: "Link", title: linkTitle(activity.lastSave) };
  return activity.lastSeenAt === null ? undefined : { _tag: "Contact" };
};

/** `just now`, `3m ago`, `5h ago`, `2d ago`. */
export const ago = (at: DateTime.Utc, now: DateTime.Utc): string => {
  const minutes = Math.floor(
    Math.max(0, DateTime.toEpochMillis(now) - DateTime.toEpochMillis(at)) / 60_000,
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

/** The status line of a source's row: `Not connected`, `Connected · last save 3m ago from iPhone`. */
export const describe = (source: Source, status: Status, now: DateTime.Utc): string => {
  if (status._tag === "NotConnected") return "Not connected";
  if (status.lastSave !== null) {
    const from = status.lastSave.deviceName === "" ? "" : ` from ${status.lastSave.deviceName}`;
    return `Connected · last save ${ago(status.lastSave.at, now)}${from}`;
  }
  return `Connected · ${source === "claude" ? "used" : "in touch"} ${ago(status.at, now)}`;
};
