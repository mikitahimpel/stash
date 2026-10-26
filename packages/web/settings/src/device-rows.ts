import type * as ApiToken from "@stash/contracts-domain/api-token";
import type * as Device from "@stash/contracts-domain/device";
import * as DateTime from "effect/DateTime";

/** One device on the settings page, with its tokens: active ones first, newest first. */
export interface DeviceRow {
  readonly device: Device.Device;
  readonly tokens: ReadonlyArray<ApiToken.ApiTokenInfo>;
}

const byActiveThenNewest = (a: ApiToken.ApiTokenInfo, b: ApiToken.ApiTokenInfo): number =>
  Number(a.revokedAt !== null) - Number(b.revokedAt !== null) ||
  DateTime.toEpochMillis(b.createdAt) - DateTime.toEpochMillis(a.createdAt);

/** Groups `tokens` under their device. Devices keep the api's order. */
export const make = (
  devices: ReadonlyArray<Device.Device>,
  tokens: ReadonlyArray<ApiToken.ApiTokenInfo>,
): ReadonlyArray<DeviceRow> =>
  devices.map((device) => ({
    device,
    tokens: tokens.filter((token) => token.deviceId === device.id).toSorted(byActiveThenNewest),
  }));

export const kindLabels: Readonly<Record<Device.DeviceKind, string>> = {
  zen: "Zen",
  ios: "iPhone",
  "mac-agent": "Mac agent",
};

/** `2026-01-31`, in UTC. */
export const formatDate = (date: DateTime.Utc): string => DateTime.formatIsoDateUtc(date);
