import * as Clipboard from "@effect/platform-browser/Clipboard";
import type * as ApiToken from "@stash/contracts-domain/api-token";
import type * as Device from "@stash/contracts-domain/device";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as PlatformTesting from "@stash/web-platform/testing";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as SettingsAtoms from "../src/settings-atoms.ts";
import * as Fixtures from "./fixtures.ts";

let registry: AtomRegistry.AtomRegistry | undefined;
const use = (routes: ApiTesting.Routes) =>
  (registry = ApiTesting.makeRegistry(routes, {
    initialValues: [[SettingsAtoms.clipboard, PlatformTesting.layerClipboard]],
  }));
afterEach(() => {
  registry?.dispose();
  registry = undefined;
});

/** A stub api that keeps devices and tokens in memory, plus a log of the calls. */
const fakeApi = () => {
  const calls: Array<string> = [];
  const devices = [Fixtures.device("d1", "Work laptop")];
  const tokens: Array<ReturnType<typeof Fixtures.token>> = [Fixtures.token("t1", "d1")];
  const routes: ApiTesting.Routes = {
    "GET /devices": () => ApiTesting.json(devices),
    "POST /devices": (request) => {
      const payload = Fixtures.body(request) as { name: string; kind: string };
      calls.push(`register ${payload.name} ${payload.kind}`);
      const device = Fixtures.device(`d${devices.length + 1}`, payload.name, payload.kind);
      devices.push(device);
      return ApiTesting.json(device, 201);
    },
    "GET /tokens": () => ApiTesting.json(tokens),
    "GET /tabs": () => ApiTesting.json(Fixtures.reports([["d1", "2026-01-05T00:00:00.000Z"]])),
    "POST /tokens": (request) => {
      const { deviceId } = Fixtures.body(request) as { deviceId: string };
      calls.push(`create token ${deviceId}`);
      const created = Fixtures.created(`t${tokens.length + 1}`, deviceId);
      tokens.push(Fixtures.token(created.id, deviceId));
      return ApiTesting.json(created, 201);
    },
    "DELETE /tokens/:id": (_, { id }) => {
      calls.push(`revoke ${id}`);
      const index = tokens.findIndex((token) => token.id === id);
      tokens[index] = { ...tokens[index]!, revokedAt: "2026-01-03T00:00:00.000Z" };
      return new Response(null, { status: 204 });
    },
  };
  return { calls, routes };
};

describe("SettingsAtoms.rows", () => {
  it.effect("loads devices and tokens", () =>
    Effect.gen(function* () {
      const reg = use(fakeApi().routes);
      const rows = yield* AtomRegistry.getResult(reg, SettingsAtoms.rows);
      expect(rows.devices.map((row) => row.device.name)).toEqual(["Work laptop"]);
      expect(rows.tokens.map((row) => [row.token.id, row.deviceName])).toEqual([
        ["t1", "Work laptop"],
      ]);
    }),
  );

  it.effect("adds when each device was last seen once the tab reports load", () =>
    Effect.gen(function* () {
      const reg = use(fakeApi().routes);
      const unmount = reg.mount(SettingsAtoms.rows);
      yield* AtomRegistry.getResult(reg, SettingsAtoms.reports);
      const rows = yield* AtomRegistry.getResult(reg, SettingsAtoms.rows);
      expect(rows.devices[0]?.lastSeen && DateTime.formatIso(rows.devices[0].lastSeen)).toBe(
        "2026-01-05T00:00:00.000Z",
      );
      unmount();
    }),
  );

  it.effect("still loads when the tab reports fail", () =>
    Effect.gen(function* () {
      const { "GET /tabs": _, ...routes } = fakeApi().routes;
      const reg = use(routes);
      const unmount = reg.mount(SettingsAtoms.rows);
      yield* AtomRegistry.getResult(reg, SettingsAtoms.reports).pipe(Effect.exit);
      const rows = yield* AtomRegistry.getResult(reg, SettingsAtoms.rows);
      expect(rows.devices.map((row) => [row.device.name, row.lastSeen])).toEqual([
        ["Work laptop", undefined],
      ]);
      unmount();
    }),
  );
});

describe("SettingsAtoms.issueToken", () => {
  it.effect("registers a new device, creates its token and refreshes the lists", () =>
    Effect.gen(function* () {
      const api = fakeApi();
      const reg = use(api.routes);
      const unmount = reg.mount(SettingsAtoms.rows);
      yield* AtomRegistry.getResult(reg, SettingsAtoms.rows);

      reg.set(SettingsAtoms.issueToken, {
        _tag: "NewDevice",
        device: { name: "iPhone", kind: "ios" },
      });
      const created = yield* AtomRegistry.getResult(reg, SettingsAtoms.issueToken, {
        suspendOnWaiting: true,
      });

      expect(api.calls).toEqual(["register iPhone ios", "create token d2"]);
      expect(created.deviceId).toBe("d2");
      expect(Redacted.value(created.token)).toBe(Fixtures.plaintext("t2"));
      const rows = yield* AtomRegistry.getResult(reg, SettingsAtoms.rows, {
        suspendOnWaiting: true,
      });
      expect(rows.devices.map((row) => row.device.name)).toEqual(["Work laptop", "iPhone"]);
      expect(rows.tokens.map((row) => [row.token.id, row.deviceName])).toEqual([
        ["t1", "Work laptop"],
        ["t2", "iPhone"],
      ]);
      unmount();
    }),
  );

  it.effect("creates another token for an existing device", () =>
    Effect.gen(function* () {
      const api = fakeApi();
      const reg = use(api.routes);
      reg.set(SettingsAtoms.issueToken, {
        _tag: "ExistingDevice",
        deviceId: "d1" as Device.DeviceId,
      });
      const created = yield* AtomRegistry.getResult(reg, SettingsAtoms.issueToken, {
        suspendOnWaiting: true,
      });
      expect(api.calls).toEqual(["create token d1"]);
      expect(created.id).toBe("t2");
    }),
  );

  it.effect("drops the plaintext on reset", () =>
    Effect.gen(function* () {
      const reg = use(fakeApi().routes);
      const unmount = reg.mount(SettingsAtoms.issueToken);
      reg.set(SettingsAtoms.issueToken, {
        _tag: "ExistingDevice",
        deviceId: "d1" as Device.DeviceId,
      });
      yield* AtomRegistry.getResult(reg, SettingsAtoms.issueToken, { suspendOnWaiting: true });
      reg.set(SettingsAtoms.issueToken, Atom.Reset);
      expect(AsyncResult.isInitial(reg.get(SettingsAtoms.issueToken))).toBe(true);
      unmount();
    }),
  );
});

describe("SettingsAtoms.revokeToken", () => {
  it.effect("calls the api and refreshes the tokens", () =>
    Effect.gen(function* () {
      const api = fakeApi();
      const reg = use(api.routes);
      const unmount = reg.mount(SettingsAtoms.rows);
      yield* AtomRegistry.getResult(reg, SettingsAtoms.rows);

      reg.set(SettingsAtoms.revokeToken, "t1" as ApiToken.ApiTokenId);
      yield* AtomRegistry.getResult(reg, SettingsAtoms.revokeToken, { suspendOnWaiting: true });

      expect(api.calls).toEqual(["revoke t1"]);
      const rows = yield* AtomRegistry.getResult(reg, SettingsAtoms.rows, {
        suspendOnWaiting: true,
      });
      expect(rows.tokens[0]?.token.revokedAt).not.toBeNull();
      unmount();
    }),
  );
});

describe("SettingsAtoms.copyToken", () => {
  it.effect("writes the plaintext to the clipboard", () =>
    Effect.gen(function* () {
      const reg = use({});
      reg.set(SettingsAtoms.copyToken, Redacted.make(Fixtures.plaintext("t9")));
      yield* AtomRegistry.getResult(reg, SettingsAtoms.copyToken, { suspendOnWaiting: true });

      // Same layer, same registry: the read sees the clipboard `copyToken` wrote to.
      const read = Atom.runtime((get) => get(SettingsAtoms.clipboard)).atom(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard.Clipboard;
          return yield* clipboard.readString;
        }),
      );
      expect(yield* AtomRegistry.getResult(reg, read)).toBe(Fixtures.plaintext("t9"));
    }),
  );
});
