import * as Clipboard from "@effect/platform-browser/Clipboard";
import type * as Device from "@stash/contracts-domain/device";
import type * as Pairing from "@stash/contracts-domain/pairing";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as WebPlatform from "@stash/web-platform/live";
import * as Effect from "effect/Effect";
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

/**
 * Approves the extension that opened `/connect/extension?code=…`: registers its device and binds
 * the code to it, so the extension can claim its token.
 */
export const approveExtension = ApiAtoms.mutation(
  ["devices", "tokens"],
  (client, input: { readonly code: Pairing.PairingCode; readonly name: string }) =>
    Effect.gen(function* () {
      const device = yield* client.devices.register({
        payload: { name: input.name, kind: "zen" },
      });
      yield* client.pairings.approve({ payload: { code: input.code, deviceId: device.id } });
      return device;
    }),
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
