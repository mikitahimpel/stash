import * as Clipboard from "@effect/platform-browser/Clipboard";
import type * as Devices from "@stash/contracts-api/devices";
import type * as ApiToken from "@stash/contracts-domain/api-token";
import type * as Device from "@stash/contracts-domain/device";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as WebPlatform from "@stash/web-platform/live";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as SettingsRows from "./settings-rows.ts";

export const devices = ApiAtoms.query(["devices"], (client) => client.devices.list());

export const tokens = ApiAtoms.query(["tokens"], (client) => client.tokens.list());

/** Every device's latest tab report, for when it was last seen. */
export const reports = ApiAtoms.query(["tabs"], (client) => client.tabs.list());

/**
 * The devices and tokens, once both lists have loaded. The last-seen times follow when the tab
 * reports load; the rows don't wait for them or fail with them.
 */
export const rows = Atom.make((get) => {
  const all = get(reports);
  return AsyncResult.map(AsyncResult.all([get(devices), get(tokens)]), ([devices, tokens]) =>
    SettingsRows.make(devices, tokens, AsyncResult.isSuccess(all) ? all.value.devices : undefined),
  );
});

/** What to issue a token for: a device registered on the spot, or one that already exists. */
/** Loads the devices, tokens and tab reports again, for the page's Retry. */
export const refresh = (registry: AtomRegistry.AtomRegistry): void => {
  registry.refresh(devices);
  registry.refresh(tokens);
  registry.refresh(reports);
};

export type IssueToken =
  | { readonly _tag: "NewDevice"; readonly device: Devices.RegisterDevice }
  | { readonly _tag: "ExistingDevice"; readonly deviceId: Device.DeviceId };

/**
 * Creates a token, registering the device first when it is new. The result holds the only copy of
 * the plaintext the client ever sees. Write `Atom.Reset` once it has been shown to drop it. The
 * atom is not kept alive, so leaving the page drops it too.
 */
export const issueToken = ApiAtoms.mutation(["devices", "tokens"], (client, issue: IssueToken) =>
  Effect.flatMap(
    issue._tag === "NewDevice"
      ? Effect.map(client.devices.register({ payload: issue.device }), (device) => device.id)
      : Effect.succeed(issue.deviceId),
    (deviceId) => client.tokens.create({ payload: { deviceId } }),
  ),
);

/** Revokes a token. It stays listed, with `revokedAt` set. */
export const revokeToken = ApiAtoms.mutation(["tokens"], (client, id: ApiToken.ApiTokenId) =>
  client.tokens.revoke({ params: { id } }),
);

/**
 * The `Clipboard` that `copyToken` writes to. Defaults to the browser's, from
 * `@stash/web-platform`. Tests replace it per registry through `initialValues`.
 */
export const clipboard: Atom.Writable<Layer.Layer<Clipboard.Clipboard>> = Atom.make(
  WebPlatform.layerClipboard,
).pipe(Atom.keepAlive);

const clipboardRuntime = Atom.runtime((get) => get(clipboard));

/** Copies the plaintext of a freshly created token. */
export const copyToken = clipboardRuntime.fn((token: Redacted.Redacted<string>) =>
  Effect.gen(function* () {
    const clipboard = yield* Clipboard.Clipboard;
    yield* clipboard.writeString(Redacted.value(token));
  }),
);
