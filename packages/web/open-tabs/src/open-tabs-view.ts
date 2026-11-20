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

/** The link a tab is saved as: enough for the row's mark and thumbnail. */
export interface SavedMark {
  readonly id: Link.LinkId;
  readonly imageUrl: Link.Url | null;
}

export interface TabRow {
  /**
   * Unique in the view and stable while tabs come and go: the device, the tab's url and which
   * tab of that url it is (a page open twice has two rows).
   */
  readonly key: string;
  readonly deviceId: Device.DeviceId;
  readonly deviceName: string;
  readonly url: Link.Url;
  /** The url's host without `www.`, or the whole url when it has none. */
  readonly host: string;
  /** As the device reported it, `null` when the tab has none. */
  readonly title: string | null;
  readonly age: Age;
  /** `active 5 min ago`, `active now`, or `null` when the device doesn't say. */
  readonly active: string | null;
  /** The window (or Zen space) the tab is in, `null` when the device has no windows. */
  readonly windowId: string | null;
  /** The link this tab is saved as, `null` when it is not in Stash. */
  readonly saved: SavedMark | null;
}

/** A window of a device, as the device named it (a Zen space) or `null`. */
export interface WindowInfo {
  readonly id: string;
  readonly name: string | null;
}

export interface DeviceGroup {
  readonly device: Device.Device;
  /** The device's windows, in the order its tabs list them. */
  readonly windows: ReadonlyArray<WindowInfo>;
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

/** When a tab was last the active one: `active now`, `active 12 min ago`, `null` when unknown. */
export const active = (
  lastActiveAt: DateTime.Utc | undefined,
  now: DateTime.Utc,
): string | null => {
  if (lastActiveAt === undefined) return null;
  const ago = span(since(lastActiveAt, now));
  return ago === null ? "active now" : `active ${ago} ago`;
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
export type SavedIndex = ReadonlyMap<string, SavedMark>;

const mark = (link: {
  readonly id: Link.LinkId;
  readonly imageUrl: Link.Url | null;
}): SavedMark => ({
  id: link.id,
  imageUrl: link.imageUrl,
});

/** The index of `links`. Of two links for one page the first wins: lists are newest first. */
export const savedIndex = (links: Iterable<Link.Link>): SavedIndex => {
  const index = new Map<string, SavedMark>();
  for (const link of links) {
    for (const url of [link.url, link.canonicalUrl]) {
      if (url === null) continue;
      const key = pageKey(url);
      if (!index.has(key)) index.set(key, mark(link));
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

/** What the page knows besides the api's own `saved`: links saved or deleted since it answered. */
export interface SavedOverlay {
  /** Links this page saved, or the stream reported, by page address. They win. */
  readonly index: SavedIndex;
  /** Links the stream reported deleted: a tab saved as one of them is not saved any more. */
  readonly deleted: ReadonlySet<string>;
}

export const noOverlay: SavedOverlay = { index: new Map(), deleted: new Set() };

const windowsOf = (tabs: ReadonlyArray<Tab.OpenTab>): ReadonlyArray<WindowInfo> => {
  const seen = new Map<string, WindowInfo>();
  for (const tab of tabs) {
    if (tab.window !== undefined && !seen.has(tab.window.id)) {
      seen.set(tab.window.id, { id: tab.window.id, name: tab.window.name ?? null });
    }
  }
  return [...seen.values()];
};

/**
 * The tabs of every device, in the order the api lists the devices and each device reported its
 * tabs, minus the `hidden` ones. A tab is saved when the api says so (by its canonical url) or
 * the overlay knows its page, unless its link was deleted since.
 */
export const group = (
  all: TabsGroup.AllTabs,
  options: {
    readonly hidden: ReadonlyArray<Hidden>;
    readonly saved?: SavedOverlay;
    readonly now: DateTime.Utc;
  },
): ReadonlyArray<DeviceGroup> => {
  const overlay = options.saved ?? noOverlay;
  return all.devices.map(({ device, snapshot, saved }) => {
    const byUrl = new Map<string, SavedMark>(
      (saved ?? []).map((tab) => [tab.url, { id: tab.linkId, imageUrl: tab.imageUrl }]),
    );
    const savedAs = (url: string): SavedMark | null => {
      const known = overlay.index.get(pageKey(url)) ?? byUrl.get(url) ?? null;
      return known === null || overlay.deleted.has(known.id) ? null : known;
    };
    const seen = new Map<string, number>();
    return {
      device,
      windows: snapshot === null ? [] : windowsOf(snapshot.tabs),
      reportedAt: snapshot?.takenAt ?? null,
      tabs:
        snapshot === null
          ? []
          : snapshot.tabs
              .map((tab) => {
                const nth = seen.get(tab.url) ?? 0;
                seen.set(tab.url, nth + 1);
                return { tab, nth };
              })
              .filter(({ tab }) => !isHidden(options.hidden, snapshot, tab))
              .map(({ tab, nth }) => ({
                key: `${device.id}#${tab.url}#${nth}`,
                deviceId: device.id,
                deviceName: device.name,
                url: tab.url,
                host: host(tab.url),
                title: tab.title,
                age: age(tab.openedAt, options.now),
                active: active(tab.lastActiveAt, options.now),
                windowId: tab.window?.id ?? null,
                saved: savedAs(tab.url),
              })),
    };
  });
};

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

/** The tabs of one window inside a device's group. */
export interface WindowPart {
  readonly id: string;
  /** `Work` (a Zen space), `Window 2`; `""` when the group has one part only. */
  readonly title: string;
  /** `4 tabs`. */
  readonly count: string;
  readonly tabs: ReadonlyArray<TabRow>;
}

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
  /**
   * The same tabs by window, in the device's order. One part (titled `""`) when the device has
   * one window or none: the page labels the parts only when there are several.
   */
  readonly windows: ReadonlyArray<WindowPart>;
}

export const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const oldestFirst = (a: TabRow, b: TabRow) => (b.age.ms ?? 0) - (a.age.ms ?? 0);

const one = (id: string, tabs: ReadonlyArray<TabRow>): ReadonlyArray<WindowPart> => [
  { id, title: "", count: plural(tabs.length, "tab", "tabs"), tabs },
];

/** A device's tabs by window: a part per window that has tabs left, named or numbered. */
export const windowParts = (
  group: DeviceGroup,
  tabs: ReadonlyArray<TabRow>,
): ReadonlyArray<WindowPart> => {
  const byWindow = Map.groupBy(tabs, (tab) => tab.windowId ?? "");
  // One part keeps its window's id, so it is the same part when a second window shows up.
  if (byWindow.size <= 1) return one(`${group.device.id}#${tabs[0]?.windowId ?? ""}`, tabs);
  const known = group.windows.map((window, index) => ({ ...window, number: index + 1 }));
  const parts: Array<WindowPart> = [];
  for (const window of known) {
    const rows = byWindow.get(window.id);
    if (rows === undefined) continue;
    parts.push({
      id: `${group.device.id}#${window.id}`,
      title: window.name ?? `Window ${window.number}`,
      count: plural(rows.length, "tab", "tabs"),
      tabs: rows,
    });
  }
  // Tabs reported without a window (an older client mixed with a newer one) come last.
  const loose = byWindow.get("");
  if (loose !== undefined) {
    parts.push({
      id: `${group.device.id}#`,
      title: "Other tabs",
      count: plural(loose.length, "tab", "tabs"),
      tabs: loose,
    });
  }
  return parts;
};

/**
 * The page's groups: one per device with its tabs in the browser's own order, then `Stale`, the
 * tabs of every device open longer than `staleAfterDays`, oldest first. A group without tabs is
 * left out.
 */
export const sections = (
  groups: ReadonlyArray<DeviceGroup>,
  now: DateTime.Utc,
): ReadonlyArray<Section> => {
  const stale = groups
    .flatMap((group) => group.tabs.filter((tab) => tab.age.stale))
    .toSorted(oldestFirst);
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
        windows: windowParts(group, tabs),
      };
    }),
    {
      id: staleId,
      kind: "stale",
      title: "Stale",
      count: plural(stale.length, "tab", "tabs"),
      note: `open longer than ${staleAfterDays} days`,
      tabs: stale,
      windows: one(staleId, stale),
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
