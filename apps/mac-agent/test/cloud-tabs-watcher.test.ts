import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Queue, Stream } from "effect";
import * as CloudTabsWatcher from "../src/cloud-tabs-watcher.ts";

const dbPath = "/synthetic/Safari/CloudTabs.db";

/** A fake file system whose `watch` plays the events the test offers, and records its path. */
const fakeFs = () => {
  const watched: Array<string> = [];
  return Effect.gen(function* () {
    const events = yield* Queue.unbounded<FileSystem.WatchEvent>();
    const layer = FileSystem.layerNoop({
      watch: (path) => {
        watched.push(path);
        return Stream.fromQueue(events);
      },
    });
    return { events, layer, watched };
  });
};

describe("CloudTabsWatcher", () => {
  it.effect("watches the database's directory and emits for its files only", () =>
    Effect.gen(function* () {
      const fs = yield* fakeFs();
      const watcher = yield* CloudTabsWatcher.make(dbPath).pipe(Effect.provide(fs.layer));
      yield* Queue.offerAll(fs.events, [
        { _tag: "Update", path: "/synthetic/Safari/CloudTabs.db-wal" },
        { _tag: "Update", path: "/synthetic/Safari/History.db" },
        { _tag: "Create", path: "/synthetic/Safari/CloudTabs.db" },
        { _tag: "Remove", path: "/synthetic/Safari/Bookmarks.plist" },
        { _tag: "Update", path: "CloudTabs.db-shm" },
      ]);
      const seen = yield* watcher.changes.pipe(Stream.take(3), Stream.runCount);
      expect(seen).toBe(3);
      expect(fs.watched).toEqual(["/synthetic/Safari"]);
    }),
  );

  it.effect("ends quietly when the directory can't be watched", () =>
    Effect.gen(function* () {
      const watcher = yield* CloudTabsWatcher.make(dbPath).pipe(
        Effect.provide(FileSystem.layerNoop({})),
      );
      expect(yield* watcher.changes.pipe(Stream.runCount)).toBe(0);
    }),
  );
});
