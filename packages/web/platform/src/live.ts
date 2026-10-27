import * as BrowserHttpClient from "@effect/platform-browser/BrowserHttpClient";
import * as BrowserKeyValueStore from "@effect/platform-browser/BrowserKeyValueStore";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as IndexedDb from "@effect/platform-browser/IndexedDb";
import * as Permissions from "@effect/platform-browser/Permissions";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import type * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Keyboard from "./keyboard.ts";
import * as Network from "./network.ts";
import * as Share from "./share.ts";
import * as Theme from "./theme.ts";
import * as Visibility from "./visibility.ts";

/**
 * Every web platform service, provided by the browser. `apps/web` provides this layer.
 *
 * - `KeyValueStore` (`effect/persistence/KeyValueStore`): backed by `localStorage`.
 * - `IndexedDb`, `Clipboard`, `Permissions` (`@effect/platform-browser/*`).
 * - `HttpClient` (`effect/http/HttpClient`): backed by `fetch`.
 * - `Share`, `Network`, `Visibility`, `Theme`, `Keyboard` (this package). `Theme` keeps its preference in
 *   `localStorage`.
 *
 * Use the individual layers below to swap one piece, for example
 * `layerSessionKeyValueStore` or `layerIndexedDbKeyValueStore`.
 */
export type Services =
  | KeyValueStore.KeyValueStore
  | IndexedDb.IndexedDb
  | Clipboard.Clipboard
  | Permissions.Permissions
  | HttpClient.HttpClient
  | Share.Share
  | Network.Network
  | Visibility.Visibility
  | Theme.Theme
  | Keyboard.Keyboard;

export const layerKeyValueStore: Layer.Layer<KeyValueStore.KeyValueStore> =
  BrowserKeyValueStore.layerLocalStorage;

export const layerSessionKeyValueStore: Layer.Layer<KeyValueStore.KeyValueStore> =
  BrowserKeyValueStore.layerSessionStorage;

export const layerIndexedDb: Layer.Layer<IndexedDb.IndexedDb> = IndexedDb.layerWindow;

/** A `KeyValueStore` in IndexedDB, for values too large for `localStorage`. */
export const layerIndexedDbKeyValueStore = (options?: {
  readonly database?: string;
}): Layer.Layer<KeyValueStore.KeyValueStore> =>
  BrowserKeyValueStore.layerIndexedDb(options).pipe(Layer.provide(layerIndexedDb));

export const layerClipboard: Layer.Layer<Clipboard.Clipboard> = Clipboard.layer;

export const layerPermissions: Layer.Layer<Permissions.Permissions> = Permissions.layer;

export const layerHttpClient: Layer.Layer<HttpClient.HttpClient> = BrowserHttpClient.layerFetch;

export const layerTheme: Layer.Layer<Theme.Theme> = Theme.layer.pipe(
  Layer.provide(layerKeyValueStore),
);

export const layerNetwork: Layer.Layer<Network.Network> = Network.layer;

export const layerKeyboard: Layer.Layer<Keyboard.Keyboard> = Keyboard.layer;

export const layer: Layer.Layer<Services> = Layer.mergeAll(
  layerKeyValueStore,
  layerIndexedDb,
  layerClipboard,
  layerPermissions,
  layerHttpClient,
  Share.layer,
  Network.layer,
  Visibility.layer,
  layerTheme,
  Keyboard.layer,
);
