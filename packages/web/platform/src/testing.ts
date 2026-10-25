import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as IndexedDb from "@effect/platform-browser/IndexedDb";
import * as Permissions from "@effect/platform-browser/Permissions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import type * as Live from "./live.ts";
import { Network } from "./network.ts";
import { Share, ShareError, type ShareData } from "./share.ts";
import { Visibility, type VisibilityState } from "./visibility.ts";

// In-memory layers for every service in `./live`. Each build starts from empty state, so a test
// that provides a layer gets its own store, clipboard, database and so on.

export const layerKeyValueStore: Layer.Layer<KeyValueStore.KeyValueStore> =
  KeyValueStore.layerMemory;

/** A fresh, empty in-memory IndexedDB (`fake-indexeddb`) per build. */
export const layerIndexedDb: Layer.Layer<IndexedDb.IndexedDb> = Layer.sync(IndexedDb.IndexedDb)(
  () => IndexedDb.make({ indexedDB: new IDBFactory(), IDBKeyRange }),
);

export const layerClipboard: Layer.Layer<Clipboard.Clipboard> = Layer.effect(Clipboard.Clipboard)(
  Effect.gen(function* () {
    const state = yield* Ref.make<{ readonly text: string; readonly items: ClipboardItems }>({
      text: "",
      items: [],
    });
    const write = (items: ClipboardItems) => Ref.set(state, { text: "", items });
    return {
      ...Clipboard.make({
        read: Effect.map(Ref.get(state), ({ items }) => items),
        readString: Effect.map(Ref.get(state), ({ text }) => text),
        write,
        writeString: (text) => Ref.set(state, { text, items: [] }),
      }),
      // The default `writeBlob` needs the `ClipboardItem` constructor, which only browsers have.
      writeBlob: (blob: Blob) =>
        write([
          { presentationStyle: "unspecified", types: [blob.type], getType: async () => blob },
        ]),
    };
  }),
);

const PermissionsTypeId = "~@effect/platform-browser/Permissions";

/** Answers `query` from `states`. Permissions not listed are `"prompt"`. */
export const layerPermissions = (
  states: Partial<Record<PermissionName, PermissionState>> = {},
): Layer.Layer<Permissions.Permissions> =>
  Layer.succeed(Permissions.Permissions)({
    [PermissionsTypeId]: PermissionsTypeId,
    query: (name) =>
      Effect.sync(() =>
        Object.assign(new EventTarget(), {
          name,
          state: states[name] ?? ("prompt" as const),
          onchange: null,
        }),
      ),
  });

/** Answers every request with `handler`. By default every request gets a 404. */
export const layerHttpClient = (
  handler: (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<Response> = () =>
    Effect.succeed(new Response(null, { status: 404 })),
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) =>
      Effect.map(handler(request), (response) => HttpClientResponse.fromWeb(request, response)),
    ),
  );

/** Test controls for the in-memory `Share`. */
export class TestShare extends Context.Service<
  TestShare,
  {
    /** Everything shared so far, oldest first. */
    readonly shared: Effect.Effect<ReadonlyArray<ShareData>>;
  }
>()("@stash/web-platform/TestShare") {}

/**
 * Records what is shared. With `supported: false` it behaves like a browser without the Web
 * Share API: `canShare` is `false` and `share` fails with `Unsupported`.
 */
export const layerShare = (
  options: { readonly supported?: boolean } = {},
): Layer.Layer<Share | TestShare> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const supported = options.supported ?? true;
      const shared = yield* Ref.make<ReadonlyArray<ShareData>>([]);
      return Context.make(Share, {
        canShare: () => Effect.succeed(supported),
        share: (data) =>
          supported
            ? Ref.update(shared, (all) => [...all, data])
            : Effect.fail(new ShareError({ reason: "Unsupported" })),
      }).pipe(Context.add(TestShare, { shared: Ref.get(shared) }));
    }),
  );

/** Test controls for the in-memory `Network`. */
export class TestNetwork extends Context.Service<
  TestNetwork,
  { readonly setOnline: (online: boolean) => Effect.Effect<void> }
>()("@stash/web-platform/TestNetwork") {}

/** Starts online unless `online: false`. Change the state with `TestNetwork.setOnline`. */
export const layerNetwork = (
  options: { readonly online?: boolean } = {},
): Layer.Layer<Network | TestNetwork> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const online = yield* SubscriptionRef.make(options.online ?? true);
      return Context.make(Network, {
        isOnline: SubscriptionRef.get(online),
        changes: SubscriptionRef.changes(online).pipe(Stream.changes),
      }).pipe(
        Context.add(TestNetwork, { setOnline: (value) => SubscriptionRef.set(online, value) }),
      );
    }),
  );

/** Test controls for the in-memory `Visibility`. */
export class TestVisibility extends Context.Service<
  TestVisibility,
  { readonly setState: (state: VisibilityState) => Effect.Effect<void> }
>()("@stash/web-platform/TestVisibility") {}

/** Starts `"visible"` unless told otherwise. Change it with `TestVisibility.setState`. */
export const layerVisibility = (
  options: { readonly state?: VisibilityState } = {},
): Layer.Layer<Visibility | TestVisibility> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make(options.state ?? "visible");
      return Context.make(Visibility, {
        current: SubscriptionRef.get(state),
        changes: SubscriptionRef.changes(state).pipe(Stream.changes),
      }).pipe(
        Context.add(TestVisibility, { setState: (value) => SubscriptionRef.set(state, value) }),
      );
    }),
  );

/** Every service from `./live`, in memory, plus the test controls. */
export const layer: Layer.Layer<Live.Services | TestShare | TestNetwork | TestVisibility> =
  Layer.mergeAll(
    layerKeyValueStore,
    layerIndexedDb,
    layerClipboard,
    layerPermissions(),
    layerHttpClient(),
    layerShare(),
    layerNetwork(),
    layerVisibility(),
  );
