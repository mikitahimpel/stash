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
  /** How long in milliseconds, `null` when unknown. */
  readonly ms: number | null;
}

export interface TabRow {
  /** Unique in the view: the device, the tab's place in its snapshot and its url. */
  readonly key: string;
  readonly deviceId: Device.DeviceId;
  readonly deviceName: string;
  readonly url: Link.Url;
  /** The url's host without `www.`, or the whole url when it has none. */
  readonly host: string;
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
export const day = 24 * hour;

/** Tabs open this long are `old`: the cron auto-archives them soon. */
export const oldAfterDays = 7;

/** A short age label (`just now`, `12m`, `5h`, `3d`) and how stale the tab is. */
export const age = (openedAt: DateTime.Utc | null, now: DateTime.Utc): Age => {
  if (openedAt === null) return { label: "age unknown", tone: "unknown", ms: null };
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
  return { label, tone, ms };
};

const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
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
            .map((tab, index) => ({ tab, index }))
            .filter(({ tab }) => !isHidden(hidden, snapshot, tab))
            .map(({ tab, index }) => ({
              key: `${device.id}#${index}#${tab.url}`,
              deviceId: device.id,
              deviceName: device.name,
              url: tab.url,
              host: host(tab.url),
              title: tab.title,
              age: age(tab.openedAt, now),
            })),
  }));

/** What the page shows: `device` is a device id, or `null` for all of them. */
export interface Filter {
  readonly device: Device.DeviceId | null;
  readonly query: string;
}

const matches = (tab: TabRow, query: string): boolean =>
  query === "" ||
  [tab.title ?? "", tab.url, tab.deviceName].some((text) => text.toLowerCase().includes(query));

/** Every group with only the tabs whose title, url or device name contains `query`. */
export const search = (
  groups: ReadonlyArray<DeviceGroup>,
  query: string,
): ReadonlyArray<DeviceGroup> => {
  const needle = query.trim().toLowerCase();
  return groups.map((group) => ({
    ...group,
    tabs: group.tabs.filter((tab) => matches(tab, needle)),
  }));
};

/** The groups that `filter` shows, each with the tabs that match it. */
export const apply = (
  groups: ReadonlyArray<DeviceGroup>,
  filter: Filter,
): ReadonlyArray<DeviceGroup> =>
  search(groups, filter.query).filter(
    (group) => filter.device === null || group.device.id === filter.device,
  );

export interface Section {
  readonly id: "old" | "week" | "unknown";
  readonly title: string;
  readonly tabs: ReadonlyArray<TabRow>;
}

const oldestFirst = (a: TabRow, b: TabRow) => (b.age.ms ?? 0) - (a.age.ms ?? 0);

/**
 * The tabs of every group in sections: older than 7 days (the cron archives those), this week,
 * and tabs whose device doesn't report an age. Oldest first. Empty sections are left out.
 */
export const sections = (groups: ReadonlyArray<DeviceGroup>): ReadonlyArray<Section> => {
  const tabs = groups.flatMap((group) => group.tabs);
  const all: ReadonlyArray<Section> = [
    {
      id: "old",
      title: `Older than ${oldAfterDays} days`,
      tabs: tabs.filter((tab) => tab.age.tone === "old").toSorted(oldestFirst),
    },
    {
      id: "week",
      title: "This week",
      tabs: tabs
        .filter((tab) => tab.age.tone === "fresh" || tab.age.tone === "aging")
        .toSorted(oldestFirst),
    },
    {
      id: "unknown",
      title: "Age unknown",
      tabs: tabs.filter((tab) => tab.age.tone === "unknown"),
    },
  ];
  return all.filter((section) => section.tabs.length > 0);
};
