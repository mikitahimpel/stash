import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as IndexedDb from "@effect/platform-browser/IndexedDb";
import * as Permissions from "@effect/platform-browser/Permissions";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Network from "../src/network.ts";
import * as Share from "../src/share.ts";
import * as Testing from "../src/testing.ts";
import * as Visibility from "../src/visibility.ts";

describe("testing layers", () => {
  it.effect("KeyValueStore is in memory and starts empty", () =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      expect(yield* store.get("token")).toBeUndefined();
      yield* store.set("token", "synthetic-value");
      expect(yield* store.get("token")).toBe("synthetic-value");
    }).pipe(Effect.provide(Testing.layerKeyValueStore)),
  );

  it.effect("IndexedDb opens a fresh in-memory database", () =>
    Effect.gen(function* () {
      const { indexedDB, IDBKeyRange } = yield* IndexedDb.IndexedDb;
      const names = yield* Effect.promise(() => indexedDB.databases());
      expect(names).toEqual([]);
      const db = yield* Effect.callback<IDBDatabase>((resume) => {
        const request = indexedDB.open("example", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("links");
        request.onsuccess = () => resume(Effect.succeed(request.result));
      });
      expect([...db.objectStoreNames]).toEqual(["links"]);
      expect(IDBKeyRange.only("a").includes("a")).toBe(true);
      db.close();
    }).pipe(Effect.provide(Testing.layerIndexedDb)),
  );

  it.effect("Clipboard keeps what was written", () =>
    Effect.gen(function* () {
      const clipboard = yield* Clipboard.Clipboard;
      yield* clipboard.writeString("https://example.com/copied");
      expect(yield* clipboard.readString).toBe("https://example.com/copied");
      yield* clipboard.clear;
      expect(yield* clipboard.readString).toBe("");
      yield* clipboard.writeBlob(new Blob(["hello"], { type: "text/plain" }));
      const [item] = yield* clipboard.read;
      expect(item?.types).toEqual(["text/plain"]);
    }).pipe(Effect.provide(Testing.layerClipboard)),
  );

  it.effect("Permissions answers from the given states", () =>
    Effect.gen(function* () {
      const permissions = yield* Permissions.Permissions;
      const notifications = yield* permissions.query("notifications");
      expect(notifications.name).toBe("notifications");
      expect(notifications.state).toBe("granted");
      expect((yield* permissions.query("geolocation")).state).toBe("prompt");
    }).pipe(Effect.provide(Testing.layerPermissions({ notifications: "granted" }))),
  );

  it.effect("HttpClient answers with the handler", () =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.get("https://example.com/api/links");
      expect(response.status).toBe(200);
      expect(yield* response.json).toEqual({ url: "https://example.com/api/links" });
    }).pipe(
      Effect.provide(
        Testing.layerHttpClient((request) =>
          Effect.succeed(Response.json({ url: request.url }, { status: 200 })),
        ),
      ),
    ),
  );

  it.effect("HttpClient answers 404 by default", () =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.get("https://example.com/missing");
      expect(response.status).toBe(404);
    }).pipe(Effect.provide(Testing.layerHttpClient())),
  );

  it.effect("layer provides every service", () =>
    Effect.gen(function* () {
      yield* KeyValueStore.KeyValueStore;
      yield* IndexedDb.IndexedDb;
      yield* Clipboard.Clipboard;
      yield* Permissions.Permissions;
      yield* HttpClient.HttpClient;
      expect(yield* (yield* Network.Network).isOnline).toBe(true);
      expect(yield* (yield* Visibility.Visibility).current).toBe("visible");
      expect(yield* (yield* Share.Share).canShare({ text: "hi" })).toBe(true);
      yield* Testing.TestNetwork;
      yield* Testing.TestVisibility;
      yield* Testing.TestShare;
    }).pipe(Effect.provide(Testing.layer)),
  );
});
