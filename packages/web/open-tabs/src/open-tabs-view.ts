import type * as TabsGroup from "@stash/contracts-api/tabs";
import type * as Device from "@stash/contracts-domain/device";
import type * as Link from "@stash/contracts-domain/link";
import type * as Tab from "@stash/contracts-domain/tab";
import * as DateTime from "effect/DateTime";

/**
 * A tab the user just archived or closed. It stays hidden until its device reports a snapshot
 * taken after `since`, so the device's own report decides whether it is really gone.
 */
export interface Hidden {
  readonly deviceId: Device.DeviceId;
  readonly url: Link.Url;
  readonly since: DateTime.Utc;
}

/** How long a tab has been open. `unknown` when the device doesn't report `openedAt`. */
export type AgeTone = "fresh" | "aging" | "old" | "unknown";

export interface Age {
  readonly label: string;
  readonly tone: AgeTone;
}

export interface TabRow {
  readonly deviceId: Device.DeviceId;
  readonly url: Link.Url;
  /** As the device reported it, `null` when the tab has none. */
  readonly title: string | null;
  readonly age: Age;
}

export interface DeviceGroup {
  readonly device: Device.Device;
  /** When the device last reported, or `null` if it never did. */
  readonly reportedAt: DateTime.Utc | null;
  /** How long ago the device reported, `null` if it never did. */
  readonly reportedAge: Age | null;
  readonly tabs: ReadonlyArray<TabRow>;
}

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** Tabs open this long are `old`: the cron auto-archives them soon. */
export const oldAfterDays = 7;

/** A short age label (`just now`, `12m`, `5h`, `3d`) and how stale the tab is. */
export const age = (openedAt: DateTime.Utc | null, now: DateTime.Utc): Age => {
  if (openedAt === null) return { label: "age unknown", tone: "unknown" };
  const ms = Math.max(0, DateTime.toEpochMillis(now) - DateTime.toEpochMillis(openedAt));
  const label =
    ms < minute
      ? "just now"
      : ms < hour
        ? `${Math.floor(ms / minute)}m`
        : ms < day
          ? `${Math.floor(ms / hour)}h`
          : `${Math.floor(ms / day)}d`;
  const tone = ms < day ? "fresh" : ms < oldAfterDays * day ? "aging" : "old";
  return { label, tone };
};

const isHidden = (
  hidden: ReadonlyArray<Hidden>,
  snapshot: Tab.TabsSnapshot,
  tab: Tab.OpenTab,
): boolean =>
  hidden.some(
    (entry) =>
      entry.deviceId === snapshot.deviceId &&
      entry.url === tab.url &&
      !DateTime.isGreaterThan(snapshot.takenAt, entry.since),
  );

/**
 * The "Open now" view: one group per device, in the order the api lists them, with the tabs in
 * the order the device reported them, minus the `hidden` ones.
 */
export const group = (
  all: TabsGroup.AllTabs,
  hidden: ReadonlyArray<Hidden>,
  now: DateTime.Utc,
): ReadonlyArray<DeviceGroup> =>
  all.devices.map(({ device, snapshot }) => ({
    device,
    reportedAt: snapshot?.takenAt ?? null,
    reportedAge: snapshot === null ? null : age(snapshot.takenAt, now),
    tabs:
      snapshot === null
        ? []
        : snapshot.tabs
            .filter((tab) => !isHidden(hidden, snapshot, tab))
            .map((tab) => ({
              deviceId: device.id,
              url: tab.url,
              title: tab.title,
              age: age(tab.openedAt, now),
            })),
  }));
