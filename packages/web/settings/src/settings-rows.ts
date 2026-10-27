import type * as TabsGroup from "@stash/contracts-api/tabs";
import type * as ApiToken from "@stash/contracts-domain/api-token";
import type * as Device from "@stash/contracts-domain/device";
import * as DateTime from "effect/DateTime";

/** One row of the Devices section. */
export interface DeviceRow {
  readonly device: Device.Device;
  /**
   * When the device last reported its tabs: `null` if it never did, `undefined` while that isn't
   * known (the tabs haven't loaded).
   */
  readonly lastSeen: DateTime.Utc | null | undefined;
}

/** One row of the API tokens section. */
export interface TokenRow {
  readonly token: ApiToken.ApiTokenInfo;
  /** The name of the token's device, `undefined` if the device isn't listed. */
  readonly deviceName: string | undefined;
}

export interface Rows {
  readonly devices: ReadonlyArray<DeviceRow>;
  readonly tokens: ReadonlyArray<TokenRow>;
}

const byActiveThenNewest = (a: ApiToken.ApiTokenInfo, b: ApiToken.ApiTokenInfo): number =>
  Number(a.revokedAt !== null) - Number(b.revokedAt !== null) ||
  DateTime.toEpochMillis(b.createdAt) - DateTime.toEpochMillis(a.createdAt);

/**
 * The rows of the settings page. Devices keep the api's order; tokens list active ones first,
 * newest first. `reports` (`GET /tabs`) gives each device's last report, when it has loaded.
 */
export const make = (
  devices: ReadonlyArray<Device.Device>,
  tokens: ReadonlyArray<ApiToken.ApiTokenInfo>,
  reports: ReadonlyArray<TabsGroup.DeviceTabs> | undefined,
): Rows => {
  const lastSeen = (id: Device.DeviceId) =>
    reports === undefined
      ? undefined
      : (reports.find((report) => report.device.id === id)?.snapshot?.takenAt ?? null);
  return {
    devices: devices.map((device) => ({ device, lastSeen: lastSeen(device.id) })),
    tokens: tokens.toSorted(byActiveThenNewest).map((token) => ({
      token,
      deviceName: devices.find((device) => device.id === token.deviceId)?.name,
    })),
  };
};

export const kindLabels: Readonly<Record<Device.DeviceKind, string>> = {
  zen: "Zen",
  ios: "iPhone",
  "mac-agent": "Mac agent",
};

/** `2026-01-31`, in UTC. */
export const formatDate = (date: DateTime.Utc): string => DateTime.formatIsoDateUtc(date);

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** A short label for when a device was last seen: `just now`, `12m ago`, `5h ago`, `3d ago`. */
export const formatLastSeen = (lastSeen: DateTime.Utc | null | undefined, now: DateTime.Utc) => {
  if (lastSeen === undefined) return "—";
  if (lastSeen === null) return "never";
  const ms = Math.max(0, DateTime.toEpochMillis(now) - DateTime.toEpochMillis(lastSeen));
  return ms < minute
    ? "just now"
    : ms < hour
      ? `${Math.floor(ms / minute)}m ago`
      : ms < day
        ? `${Math.floor(ms / hour)}h ago`
        : `${Math.floor(ms / day)}d ago`;
};
