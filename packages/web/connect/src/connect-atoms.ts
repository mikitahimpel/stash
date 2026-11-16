import * as Clipboard from "@effect/platform-browser/Clipboard";
import type * as Device from "@stash/contracts-domain/device";
import type * as Pairing from "@stash/contracts-domain/pairing";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as WebPlatform from "@stash/web-platform/live";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Layer from "effect/Layer";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type * as ConnectStatus from "./connect-status.ts";

export const devices = ApiAtoms.query(["devices"], (client) => client.devices.list());

/** Each device's last contact and save. Guides refresh it while they wait (`poll`). */
export const activity = ApiAtoms.query(["devices", "links", "tabs"], (client) =>
  client.devices.activity(),
);

export const tokens = ApiAtoms.query(["tokens"], (client) => client.tokens.list());

/** The MCP endpoint, for the Claude guide. */
export const info = ApiAtoms.query([], (client) => client.connect.info());

/** Devices, activity and tokens, once all three have loaded. */
export const snapshot = Atom.make((get) =>
  AsyncResult.map(
    AsyncResult.all([get(devices), get(activity), get(tokens)]),
    ([devices, activity, tokens]): ConnectStatus.Snapshot => ({ devices, activity, tokens }),
  ),
);

/** Loads the status again: for the page's Retry, and every few seconds while a guide waits. */
export const refresh = (registry: AtomRegistry.AtomRegistry): void => {
  registry.refresh(devices);
  registry.refresh(activity);
  registry.refresh(tokens);
};

/** How often a waiting guide asks the api whether its device got in touch. */
export const pollMillis = 3000;

/** What a guide sets up: a device, and its token when the device signs in with one. */
export interface SetUp {
  readonly kind: Device.DeviceKind;
  readonly name: string;
  readonly withToken: boolean;
}

/**
 * Registers a device and, if asked, creates its token. The result holds the only copy of the
 * plaintext the client ever sees.
 */
export const setUp = ApiAtoms.mutation(["devices", "tokens"], (client, input: SetUp) =>
  Effect.gen(function* () {
    const device = yield* client.devices.register({
      payload: { name: input.name, kind: input.kind },
    });
    const token = input.withToken
      ? (yield* client.tokens.create({ payload: { deviceId: device.id } })).token
      : undefined;
    return { device, token };
  }),
);

/** Creates another token for a device the guide set up (the iPhone's Advanced Shortcut). */
export const createToken = ApiAtoms.mutation(["tokens"], (client, deviceId: Device.DeviceId) =>
  Effect.map(client.tokens.create({ payload: { deviceId } }), (created) => created.token),
);

/**
 * Approves the extension that opened `/connect/extension?code=…`. The api registers its Zen device
 * and binds the code to it in one go (a used code registers nothing), so the extension can claim
 * its token.
 */
export const approveExtension = ApiAtoms.mutation(
  ["devices", "tokens"],
  (client, input: { readonly code: Pairing.PairingCode; readonly name: string }) =>
    client.pairings.approve({ payload: { code: input.code, name: input.name } }),
);

/**
 * The `Clipboard` that `copy` writes to. Defaults to the browser's, from `@stash/web-platform`.
 * Tests replace it per registry through `initialValues`.
 */
export const clipboard: Atom.Writable<Layer.Layer<Clipboard.Clipboard>> = Atom.make(
  WebPlatform.layerClipboard,
).pipe(Atom.keepAlive);

const clipboardRuntime = Atom.runtime((get) => get(clipboard));

/** Copies a prefilled value. */
export const copy = clipboardRuntime.fn((text: string) =>
  Effect.flatMap(Clipboard.Clipboard, (clipboard) => clipboard.writeString(text)),
);

/**
 * The `HttpClient` that reads this deploy's static files (`extensionSigned`). Defaults to the
 * browser's. Tests replace it per registry through `initialValues`.
 */
export const downloads: Atom.Writable<Layer.Layer<HttpClient.HttpClient>> = Atom.make(
  WebPlatform.layerHttpClient,
).pipe(Atom.keepAlive);

const downloadsRuntime = Atom.runtime((get) => get(downloads));

/** Where the build says whether the `.xpi` is signed (see `apps/extension/scripts/xpi-info.ts`). */
export const extensionInfoPath = "/downloads/stash-extension.json";

const ExtensionInfo = Schema.Struct({ signed: Schema.Boolean });

/**
 * Whether Mozilla signed the `.xpi` this deploy serves. Release Firefox and Zen install only signed
 * add-ons, so the Zen guide shows other steps for an unsigned one. `false` when unknown.
 */
export const extensionSigned = downloadsRuntime.atom(
  Effect.gen(function* () {
    const response = yield* HttpClient.get(extensionInfoPath);
    if (response.status !== 200) return false;
    const info = Schema.decodeUnknownOption(ExtensionInfo)(yield* response.json);
    return Option.exists(info, (it) => it.signed);
  }).pipe(Effect.catch(() => Effect.succeed(false))),
);
