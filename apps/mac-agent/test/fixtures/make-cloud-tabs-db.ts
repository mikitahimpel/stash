/**
 * Builds a synthetic CloudTabs.db: invented devices, tabs and URLs, shaped like Safari's tables
 * (including columns the reader ignores). Never copy a real CloudTabs.db into the repo.
 *
 * Tests call `makeCloudTabsDb`. To inspect the fixture by hand:
 * `pnpm --filter @stash/mac-agent fixture:cloud-tabs <out.db>`
 */
import { DatabaseSync } from "node:sqlite";

export const phoneUuid = "00000000-0000-4000-8000-000000000001";
export const tabletUuid = "00000000-0000-4000-8000-000000000002";
export const orphanUuid = "00000000-0000-4000-8000-000000000003";

const schema = `
CREATE TABLE cloud_tab_devices (
  device_uuid TEXT PRIMARY KEY NOT NULL,
  system_fields BLOB NOT NULL,
  device_name TEXT,
  has_duplicate_device_name BOOLEAN NOT NULL DEFAULT 0,
  is_ephemeral_device BOOLEAN NOT NULL DEFAULT 0,
  last_modified REAL NOT NULL DEFAULT 0
);
CREATE TABLE cloud_tabs (
  tab_uuid TEXT PRIMARY KEY NOT NULL,
  system_fields BLOB NOT NULL,
  device_uuid TEXT NOT NULL,
  position BLOB NOT NULL,
  title TEXT,
  url TEXT NOT NULL,
  is_showing_reader BOOLEAN NOT NULL DEFAULT 0,
  is_pinned BOOLEAN NOT NULL DEFAULT 0
);
`;

const devices: ReadonlyArray<readonly [uuid: string, name: string]> = [
  [phoneUuid, "Test iPhone"],
  [tabletUuid, "Test iPad"],
];

const tabs: ReadonlyArray<readonly [device: string, title: string | null, url: string]> = [
  [phoneUuid, "Example article", "https://example.com/article"],
  [phoneUuid, "", "https://example.com/untitled"],
  [phoneUuid, "Blank", "about:blank"],
  [phoneUuid, "Video", "https://video.example.org/watch?v=abc"],
  [orphanUuid, null, "https://example.net/orphan"],
];

export const makeCloudTabsDb = (path: string): void => {
  const db = new DatabaseSync(path);
  try {
    db.exec(schema);
    const blob = new Uint8Array([0]);
    const insertDevice = db.prepare(
      "INSERT INTO cloud_tab_devices (device_uuid, system_fields, device_name) VALUES (?, ?, ?)",
    );
    for (const [uuid, name] of devices) insertDevice.run(uuid, blob, name);
    const insertTab = db.prepare(
      "INSERT INTO cloud_tabs (tab_uuid, system_fields, device_uuid, position, title, url) VALUES (?, ?, ?, ?, ?, ?)",
    );
    tabs.forEach(([device, title, url], i) =>
      insertTab.run(`tab-${i}`, blob, device, blob, title, url),
    );
  } finally {
    db.close();
  }
};

if (import.meta.main) {
  const out = process.argv[2];
  if (out === undefined) {
    console.error("usage: make-cloud-tabs-db.ts <out.db>");
    process.exit(1);
  }
  makeCloudTabsDb(out);
}
