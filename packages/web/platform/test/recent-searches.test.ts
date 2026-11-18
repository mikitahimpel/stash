import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as TestClock from "effect/testing/TestClock";
import * as RecentSearches from "../src/recent-searches.ts";
import * as Testing from "../src/testing.ts";

const layer = RecentSearches.layer.pipe(Layer.provideMerge(Testing.layerKeyValueStore));
const recent = RecentSearches.RecentSearches;
const queries = (entries: ReadonlyArray<RecentSearches.Entry>) =>
  entries.map((entry) => entry.query);

describe("RecentSearches", () => {
  it.effect("starts empty and lists the newest search first, with its time", () =>
    Effect.gen(function* () {
      expect(yield* recent.use((r) => r.list)).toEqual([]);
      yield* TestClock.setTime(1_000);
      yield* recent.use((r) => r.add("  economics video "));
      yield* TestClock.setTime(2_000);
      expect(yield* recent.use((r) => r.add("sqlite"))).toEqual([
        { query: "sqlite", at: 2_000 },
        { query: "economics video", at: 1_000 },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("moves a repeated query to the front instead of listing it twice", () =>
    Effect.gen(function* () {
      yield* recent.use((r) => r.add("rust"));
      yield* recent.use((r) => r.add("go"));
      expect(queries(yield* recent.use((r) => r.add("Rust")))).toEqual(["Rust", "go"]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("ignores a blank query and keeps at most maxEntries", () =>
    Effect.gen(function* () {
      for (let i = 0; i < RecentSearches.maxEntries + 3; i++) {
        yield* recent.use((r) => r.add(`query ${i}`));
      }
      const entries = yield* recent.use((r) => r.add("   "));
      expect(entries).toHaveLength(RecentSearches.maxEntries);
      expect(entries[0]?.query).toBe(`query ${RecentSearches.maxEntries + 2}`);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("removes one search, and clears them all", () =>
    Effect.gen(function* () {
      yield* recent.use((r) => r.add("rust"));
      yield* recent.use((r) => r.add("go"));
      expect(queries(yield* recent.use((r) => r.remove("RUST")))).toEqual(["go"]);
      yield* recent.use((r) => r.clear);
      expect(yield* recent.use((r) => r.list)).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps the list in the store, and reads junk there as an empty list", () =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* recent.use((r) => r.add("rust"));
      expect(JSON.parse((yield* store.get(RecentSearches.storageKey)) ?? "")).toMatchObject([
        { query: "rust" },
      ]);
      yield* store.set(RecentSearches.storageKey, "{not json");
      expect(yield* recent.use((r) => r.list)).toEqual([]);
      yield* store.set(RecentSearches.storageKey, JSON.stringify([{ query: 1 }]));
      expect(yield* recent.use((r) => r.list)).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );
});
