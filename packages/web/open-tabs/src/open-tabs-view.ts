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

/** How long a tab has been open. All `null` when the device doesn't report `openedAt`. */
export interface Age {
  /** `open 3 d`, or `null` when unknown: the row then says nothing about time. */
  readonly label: string | null;
  /** How long in milliseconds, `null` when unknown. */
  readonly ms: number | null;
  /** Open longer than `staleAfterDays`: the cron auto-archives it soon. */
  readonly stale: boolean;
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
  /** The link this tab is saved as, `null` when it is not in Stash (as far as the page knows). */
  readonly saved: Link.Link | null;
}

export interface DeviceGroup {
  readonly device: Device.Device;
  /** When the device last reported, or `null` if it never did. */
  readonly reportedAt: DateTime.Utc | null;
  readonly tabs: ReadonlyArray<TabRow>;
}

const minute = 60_000;
const hour = 60 * minute;
export const day = 24 * hour;

/** Tabs open longer than this are stale: the cron auto-archives them soon. */
export const staleAfterDays = 7;

/** `45 s` is nothing to tell; then whole minutes, hours and days: `12 min`, `5 h`, `3 d`. */
const span = (ms: number): string | null =>
  ms < minute
    ? null
    : ms < hour
      ? `${Math.floor(ms / minute)} min`
      : ms < day
        ? `${Math.floor(ms / hour)} h`
        : `${Math.floor(ms / day)} d`;

const since = (at: DateTime.Utc, now: DateTime.Utc): number =>
  Math.max(0, DateTime.toEpochMillis(now) - DateTime.toEpochMillis(at));

/**
 * How long a tab has been open (`open 12 min`, `open 5 h`, `open 3 d`), from when the browser
 * says it was opened. A tab without that time has no label: when it was last synced says nothing
 * about the tab.
 */
export const age = (openedAt: DateTime.Utc | null, now: DateTime.Utc): Age => {
  if (openedAt === null) return { label: null, ms: null, stale: false };
  const ms = since(openedAt, now);
  return { label: `open ${span(ms) ?? "just now"}`, ms, stale: ms >= staleAfterDays * day };
};

/** When a device last reported its tabs: `synced just now`, `synced 5 min ago`, `never synced`. */
export const synced = (reportedAt: DateTime.Utc | null, now: DateTime.Utc): string => {
  if (reportedAt === null) return "never synced";
  const ago = span(since(reportedAt, now));
  return ago === null ? "synced just now" : `synced ${ago} ago`;
};

const kindNames: Readonly<Record<Device.DeviceKind, string | null>> = {
  zen: "Zen",
  // An iPhone's and a Mac agent's tabs are Safari's; the device's own name says enough.
  ios: null,
  "mac-agent": null,
};

/** A device as a group's title: `Zen on Work laptop`, or its name when that already says it. */
export const deviceTitle = (device: Device.Device): string => {
  const kind = kindNames[device.kind];
  return kind === null || device.name.toLowerCase().includes(kind.toLowerCase())
    ? device.name
    : `${kind} on ${device.name}`;
};

const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
};

/**
 * A url as the key two addresses of one page share: no fragment, no trailing slash, the host in
 * lower case. The api knows more (a page's canonical url); this is what the page can tell alone.
 */
export const pageKey = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return url;
  }
};

/** Saved links by the address of their page (`pageKey` of the url and of the canonical url). */
export type SavedIndex = ReadonlyMap<string, Link.Link>;

/** The index of `links`. Of two links for one page the first wins: lists are newest first. */
export const savedIndex = (links: Iterable<Link.Link>): SavedIndex => {
  const index = new Map<string, Link.Link>();
  for (const link of links) {
    for (const url of [link.url, link.canonicalUrl]) {
      if (url === null) continue;
      const key = pageKey(url);
      if (!index.has(key)) index.set(key, link);
    }
  }
  return index;
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
 * The tabs of every device, in the order the api lists the devices and each device reported its
 * tabs, minus the `hidden` ones. A tab whose page is in `saved` carries its link.
 */
export const group = (
  all: TabsGroup.AllTabs,
  options: {
    readonly hidden: ReadonlyArray<Hidden>;
    readonly saved: SavedIndex;
    readonly now: DateTime.Utc;
  },
): ReadonlyArray<DeviceGroup> =>
  all.devices.map(({ device, snapshot }) => ({
    device,
    reportedAt: snapshot?.takenAt ?? null,
    tabs:
      snapshot === null
        ? []
        : snapshot.tabs
            .map((tab, index) => ({ tab, index }))
            .filter(({ tab }) => !isHidden(options.hidden, snapshot, tab))
            .map(({ tab, index }) => ({
              key: `${device.id}#${index}#${tab.url}`,
              deviceId: device.id,
              deviceName: device.name,
              url: tab.url,
              host: host(tab.url),
              title: tab.title,
              age: age(tab.openedAt, options.now),
              saved: options.saved.get(pageKey(tab.url)) ?? null,
            })),
  }));

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

/** The id of the group of stale tabs. A device's group has the device's id. */
export const staleId = "stale";

/** A group of rows on the page: a device's tabs, or the stale tabs of every device. */
export interface Section {
  /** The device's id, or `staleId`. */
  readonly id: string;
  readonly kind: "device" | "stale";
  /** `Zen on Work laptop`, `Stale`. */
  readonly title: string;
  /** `11 tabs`. */
  readonly count: string;
  /** Once per group: `synced just now` for a device, what stale means for the stale tabs. */
  readonly note: string;
  readonly tabs: ReadonlyArray<TabRow>;
}

export const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const oldestFirst = (a: TabRow, b: TabRow) => (b.age.ms ?? 0) - (a.age.ms ?? 0);

/**
 * The page's groups: one per device with its tabs in the browser's own order, then `Stale`, the
 * tabs of every device open longer than `staleAfterDays`, oldest first. A group without tabs is
 * left out.
 */
export const sections = (
  groups: ReadonlyArray<DeviceGroup>,
  now: DateTime.Utc,
): ReadonlyArray<Section> => {
  const stale = groups.flatMap((group) => group.tabs.filter((tab) => tab.age.stale));
  const all: ReadonlyArray<Section> = [
    ...groups.map((group) => {
      const tabs = group.tabs.filter((tab) => !tab.age.stale);
      return {
        id: group.device.id as string,
        kind: "device" as const,
        title: deviceTitle(group.device),
        count: plural(tabs.length, "tab", "tabs"),
        note: synced(group.reportedAt, now),
        tabs,
      };
    }),
    {
      id: staleId,
      kind: "stale",
      title: "Stale",
      count: plural(stale.length, "tab", "tabs"),
      note: `open longer than ${staleAfterDays} days`,
      tabs: stale.toSorted(oldestFirst),
    },
  ];
  return all.filter((section) => section.tabs.length > 0);
};

/** The line under the page title: `23 tabs open · 6 older than a week`. */
export const summary = (groups: ReadonlyArray<DeviceGroup>): string => {
  const tabs = groups.flatMap((group) => group.tabs);
  if (tabs.length === 0) return "";
  const stale = tabs.filter((tab) => tab.age.stale).length;
  return [
    `${plural(tabs.length, "tab", "tabs")} open`,
    ...(stale > 0 ? [`${stale} older than a week`] : []),
  ].join(" · ");
};
