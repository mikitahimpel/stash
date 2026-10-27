import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as IndexedDb from "@effect/platform-browser/IndexedDb";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import * as Live from "../src/live.ts";
import * as Network from "../src/network.ts";
import * as Theme from "../src/theme.ts";
import * as Visibility from "../src/visibility.ts";

// Synthetic stand-ins for the browser globals the live layers read.
const storage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("live layer", () => {
  it.effect("provides every service from the browser globals", () => {
    const localStorage = storage();
    const writes: Array<string> = [];
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        indexedDB: new IDBFactory(),
        IDBKeyRange,
        matchMedia: () => Object.assign(new EventTarget(), { matches: true }),
      }),
    );
    const classes = new Set<string>();
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), {
        visibilityState: "hidden",
        documentElement: {
          classList: { toggle: (name: string, force: boolean) => force && !!classes.add(name) },
        },
      }),
    );
    vi.stubGlobal("navigator", {
      onLine: true,
      clipboard: { writeText: async (text: string) => void writes.push(text) },
    });
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("fetch", async (input: Request | URL | string) =>
      Response.json({ url: input instanceof Request ? input.url : String(input) }),
    );
    return Effect.gen(function* () {
      yield* (yield* KeyValueStore.KeyValueStore).set("theme", "dark");
      expect(localStorage.getItem("theme")).toBe("dark");

      expect((yield* IndexedDb.IndexedDb).indexedDB).toBeInstanceOf(IDBFactory);

      yield* (yield* Clipboard.Clipboard).writeString("https://example.com/copied");
      expect(writes).toEqual(["https://example.com/copied"]);

      const response = yield* (yield* HttpClient.HttpClient).get("https://example.com/api");
      expect(yield* response.json).toEqual({ url: "https://example.com/api" });

      expect(yield* (yield* Network.Network).isOnline).toBe(true);
      expect(yield* (yield* Visibility.Visibility).current).toBe("hidden");

      expect(yield* (yield* Theme.Theme).current).toEqual({ preference: "system", scheme: "dark" });
      expect(classes.has("dark")).toBe(true);
    }).pipe(Effect.provide(Live.layer));
  });
});
