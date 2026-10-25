// Synthetic devices, tabs and commands in their wire (JSON) form.

export const takenAt = "2026-01-10T12:00:00.000Z";

export const tab = (path: string, openedAt: string | null = "2026-01-10T11:00:00.000Z") => ({
  url: `https://example.com/${path}`,
  title: `Example ${path}` as string | null,
  openedAt,
  lastSeenAt: takenAt,
});

export const device = (id: string, name = `Device ${id}`) => ({
  id,
  name,
  kind: "zen",
  createdAt: "2026-01-01T00:00:00.000Z",
});

export const deviceTabs = (
  id: string,
  tabs: ReadonlyArray<ReturnType<typeof tab>> | null,
  at = takenAt,
) => ({
  device: device(id),
  snapshot: tabs === null ? null : { deviceId: id, takenAt: at, tabs },
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

export const archived = (deviceId: string, url: string, title: string | null) => ({
  link: {
    id: "link-1",
    url,
    canonicalUrl: null,
    title,
    status: "archived",
    type: null,
    summary: null,
    language: null,
    tags: [],
    sourceDeviceId: deviceId,
    createdAt: takenAt,
    enrichedAt: null,
  },
  command: command(deviceId, url),
});
