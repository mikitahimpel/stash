// Synthetic devices, tabs and commands in their wire (JSON) form.

export const takenAt = "2026-01-10T12:00:00.000Z";

export const tab = (path: string, openedAt: string | null = "2026-01-10T11:00:00.000Z") => ({
  url: `https://example.com/${path}`,
  title: `Example ${path}` as string | null,
  openedAt,
  lastSeenAt: takenAt,
});

/** A tab in a window (or Zen space), last active at `lastActiveAt`. */
export const windowTab = (
  path: string,
  window: { readonly id: string; readonly name?: string },
  lastActiveAt?: string,
) => ({
  ...tab(path),
  window,
  ...(lastActiveAt === undefined ? {} : { lastActiveAt }),
});

export const device = (id: string, name = `Device ${id}`) => ({
  id,
  name,
  kind: "zen",
  createdAt: "2026-01-01T00:00:00.000Z",
});

export const deviceTabs = (
  id: string,
  tabs: ReadonlyArray<ReturnType<typeof tab> | ReturnType<typeof windowTab>> | null,
  at = takenAt,
  saved: ReadonlyArray<{ url: string; linkId: string; imageUrl: string | null }> = [],
) => ({
  device: device(id),
  snapshot: tabs === null ? null : { deviceId: id, takenAt: at, tabs },
  saved,
});

/** A `tabs.updated` event of the live stream, as its JSON text. */
export const tabsUpdated = (entry: ReturnType<typeof deviceTabs>, at = takenAt) =>
  JSON.stringify({
    type: "tabs.updated",
    at,
    device: entry.device,
    snapshot: entry.snapshot,
    saved: entry.saved,
  });

export const allTabs = (...devices: ReadonlyArray<ReturnType<typeof deviceTabs>>) => ({
  devices,
});

export const command = (deviceId: string, url: string) => ({
  id: `command-${deviceId}`,
  deviceId,
  payload: { kind: "close-tab", url },
  status: "pending",
  createdAt: takenAt,
  completedAt: null,
});

/** A saved link in its wire form. */
export const link = (
  id: string,
  url: string,
  fields: { readonly title?: string | null; readonly imageUrl?: string | null } = {},
) => ({
  id,
  url,
  canonicalUrl: null,
  title: fields.title ?? null,
  status: "new",
  type: null,
  summary: null,
  language: null,
  tags: [],
  sourceDeviceId: null,
  createdAt: takenAt,
  imageUrl: fields.imageUrl ?? null,
  author: null,
  enrichedAt: null,
});

export const linksPage = (...items: ReadonlyArray<ReturnType<typeof link>>) => ({
  items,
  nextCursor: null,
});

export const archived = (deviceId: string, url: string, title: string | null) => ({
  link: { ...link("link-1", url, { title }), status: "archived", sourceDeviceId: deviceId },
  command: command(deviceId, url),
});
