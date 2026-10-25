import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as CloudTabsReader from "../src/cloud-tabs-reader.ts";
import {
  makeCloudTabsDb,
  orphanUuid,
  phoneUuid,
  tabletUuid,
} from "./fixtures/make-cloud-tabs-db.ts";

let dir: string;
let dbPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "stash-cloud-tabs-"));
  dbPath = join(dir, "CloudTabs.db");
  makeCloudTabsDb(dbPath);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const read = (path: string) =>
  CloudTabsReader.CloudTabsReader.use((reader) => reader.read).pipe(
    Effect.provide(CloudTabsReader.layer(path)),
  );

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("CloudTabsReader", () => {
  it.effect("reads one snapshot per iCloud device", () =>
    Effect.gen(function* () {
      const devices = yield* read(dbPath);
      const byId = new Map(devices.map((device) => [device.snapshot.deviceId as string, device]));
      expect([...byId.keys()].sort()).toEqual([phoneUuid, tabletUuid, orphanUuid].sort());

      const phone = byId.get(phoneUuid)!;
      expect(phone.name).toBe("Test iPhone");
      expect(phone.snapshot.tabs.map((tab) => [tab.url, tab.title])).toEqual([
        ["https://example.com/article", "Example article"],
        ["https://example.com/untitled", null],
        ["https://video.example.org/watch?v=abc", "Video"],
      ]);
      for (const tab of phone.snapshot.tabs) {
        expect(tab.openedAt).toBeNull();
        expect(tab.lastSeenAt).toEqual(phone.snapshot.takenAt);
      }
    }),
  );

  it.effect("keeps devices without tabs as empty snapshots", () =>
    Effect.gen(function* () {
      const devices = yield* read(dbPath);
      const tablet = devices.find((device) => device.snapshot.deviceId === tabletUuid)!;
      expect(tablet.name).toBe("Test iPad");
      expect(tablet.snapshot.tabs).toEqual([]);
    }),
  );

  it.effect("keeps tabs of a device without a device row, unnamed", () =>
    Effect.gen(function* () {
      const devices = yield* read(dbPath);
      const orphan = devices.find((device) => device.snapshot.deviceId === orphanUuid)!;
      expect(orphan.name).toBeNull();
      expect(orphan.snapshot.tabs.map((tab) => tab.url)).toEqual(["https://example.net/orphan"]);
    }),
  );

  it.effect("does not modify the database", () =>
    Effect.gen(function* () {
      const before = sha(dbPath);
      yield* read(dbPath);
      expect(sha(dbPath)).toBe(before);
    }),
  );

  it.effect("fails with CloudTabsReadError when the file is missing", () =>
    Effect.gen(function* () {
      const path = join(dir, "missing.db");
      const error = yield* Effect.flip(read(path));
      expect(error._tag).toBe("CloudTabsReadError");
      expect(error.path).toBe(path);
    }),
  );

  it.effect("fails with CloudTabsReadError when the tables are missing", () =>
    Effect.gen(function* () {
      const path = join(dir, "empty.db");
      new DatabaseSync(path).close();
      const error = yield* Effect.flip(read(path));
      expect(error._tag).toBe("CloudTabsReadError");
    }),
  );

  it("defaults to Safari's container path", () => {
    expect(CloudTabsReader.defaultPath("/Users/someone")).toBe(
      "/Users/someone/Library/Containers/com.apple.Safari/Data/Library/Safari/CloudTabs.db",
    );
  });

  it.effect("takes the path from STASH_CLOUD_TABS_DB", () =>
    Effect.gen(function* () {
      const devices = yield* CloudTabsReader.CloudTabsReader.use((reader) => reader.read).pipe(
        Effect.provide(
          CloudTabsReader.layerConfig.pipe(
            Layer.provide(
              ConfigProvider.layer(
                ConfigProvider.fromEnv({ env: { STASH_CLOUD_TABS_DB: dbPath } }),
              ),
            ),
          ),
        ),
      );
      expect(devices).toHaveLength(3);
    }),
  );
});
