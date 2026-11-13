import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as Pairing from "@stash/contracts-domain/pairing";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as PlatformTesting from "@stash/web-platform/testing";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as ConnectAtoms from "../src/connect-atoms.ts";
import * as ConnectStatus from "../src/connect-status.ts";
import { fakeApi } from "./fake-api.ts";

let registry: AtomRegistry.AtomRegistry | undefined;
const use = (routes: ApiTesting.Routes) =>
  (registry = ApiTesting.makeRegistry(routes, {
    initialValues: [[ConnectAtoms.clipboard, PlatformTesting.layerClipboard]],
  }));
afterEach(() => {
  registry?.dispose();
  registry = undefined;
});

const run = <A>(reg: AtomRegistry.AtomRegistry, atom: Atom.AtomResultFn<A, any, any>, arg: A) =>
  Effect.gen(function* () {
    reg.set(atom, arg);
    return yield* AtomRegistry.getResult(reg, atom, { suspendOnWaiting: true });
  });

describe("ConnectAtoms", () => {
  it.effect("sets up a device with a token for the Mac, and without one for the iPhone", () =>
    Effect.gen(function* () {
      const api = fakeApi();
      const reg = use(api.routes);
      const mac = yield* run(reg, ConnectAtoms.setUp, {
        kind: "mac-agent",
        name: "Synthetic Mac",
        withToken: true,
      });
      expect(mac.device.kind).toBe("mac-agent");
      expect(mac.token && Redacted.value(mac.token)).toBe("stash_synthetic_token-1");

      const iphone = yield* run(reg, ConnectAtoms.setUp, {
        kind: "ios",
        name: "Synthetic iPhone",
        withToken: false,
      });
      expect(iphone.token).toBeUndefined();
      expect(api.calls).toEqual([
        "register Synthetic Mac mac-agent",
        "create token device-1",
        "register Synthetic iPhone ios",
      ]);
    }),
  );

  it.effect("approves an extension: a Zen device, then the pairing", () =>
    Effect.gen(function* () {
      const api = fakeApi();
      const reg = use(api.routes);
      const code = Pairing.PairingCode.make("synthetic-pairing-code-0000000000000000000");
      const device = yield* run(reg, ConnectAtoms.approveExtension, { code, name: "Zen" });
      expect(device.kind).toBe("zen");
      expect(api.calls).toEqual(["register Zen zen", `approve ${code} device-1`]);
    }),
  );

  it.effect("turns the status connected once the device gets in touch", () =>
    Effect.gen(function* () {
      const api = fakeApi();
      const reg = use(api.routes);
      const unmount = reg.mount(ConnectAtoms.snapshot);
      const { device } = yield* run(reg, ConnectAtoms.setUp, {
        kind: "zen",
        name: "Zen",
        withToken: false,
      });
      const snapshot = () =>
        AtomRegistry.getResult(reg, ConnectAtoms.snapshot, { suspendOnWaiting: true });
      const awaited = { _tag: "Device", deviceId: device.id } as const;
      expect(ConnectStatus.arrival(awaited, yield* snapshot())).toBeUndefined();

      api.arrive(device.id, "2026-02-01T00:00:00.000Z", "A synthetic save");
      ConnectAtoms.refresh(reg);
      expect(ConnectStatus.arrival(awaited, yield* snapshot())).toEqual({
        _tag: "Link",
        title: "A synthetic save",
      });
      unmount();
    }),
  );

  it.effect("reads the MCP endpoint", () =>
    Effect.gen(function* () {
      const reg = use(fakeApi().routes);
      expect(yield* AtomRegistry.getResult(reg, ConnectAtoms.info)).toEqual({
        mcpUrl: "https://mcp.example.com/mcp",
      });
    }),
  );

  it.effect("copies a value", () =>
    Effect.gen(function* () {
      const reg = use(fakeApi().routes);
      yield* run(reg, ConnectAtoms.copy, "https://stash.example.com/save?url=");
      const read = Atom.runtime((get) => get(ConnectAtoms.clipboard)).atom(
        Effect.flatMap(Clipboard.Clipboard, (clipboard) => clipboard.readString),
      );
      expect(yield* AtomRegistry.getResult(reg, read)).toBe("https://stash.example.com/save?url=");
    }),
  );
});
