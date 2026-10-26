import * as AtomVue from "@effect/atom-vue";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as ApiTesting from "@stash/web-api-client/testing";
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, describe, expect, it } from "vitest";
import SettingsPage from "../src/settings-page.vue";
import * as SettingsAtoms from "../src/settings-atoms.ts";
import * as Fixtures from "./fixtures.ts";

enableAutoUnmount(afterEach);

let registry: AtomRegistry.AtomRegistry | undefined;
afterEach(() => {
  registry?.dispose();
  registry = undefined;
});

let page: DOMWrapper<HTMLElement> | undefined;
/** Dialogs teleport to <body>, outside the wrapper, so tests query the whole page. */
const body = (): DOMWrapper<HTMLElement> => page!;

const settle = async () => {
  // Stub responses resolve over a few microtask and timer turns.
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const mountPage = async () => {
  const calls: Array<string> = [];
  const copied: Array<string> = [];
  const devices = [Fixtures.device("d1", "Work laptop")];
  const tokens: Array<ReturnType<typeof Fixtures.token>> = [Fixtures.token("t1", "d1")];
  registry = ApiTesting.makeRegistry(
    {
      "GET /devices": () => ApiTesting.json(devices),
      "POST /devices": (request) => {
        const payload = Fixtures.body(request) as { name: string; kind: string };
        calls.push(`register ${payload.name} ${payload.kind}`);
        const device = Fixtures.device("d2", payload.name, payload.kind);
        devices.push(device);
        return ApiTesting.json(device, 201);
      },
      "GET /tokens": () => ApiTesting.json(tokens),
      "POST /tokens": (request) => {
        const { deviceId } = Fixtures.body(request) as { deviceId: string };
        calls.push(`create token ${deviceId}`);
        tokens.push(Fixtures.token("t2", deviceId));
        return ApiTesting.json(Fixtures.created("t2", deviceId), 201);
      },
      "DELETE /tokens/:id": (_, { id }) => {
        calls.push(`revoke ${id}`);
        tokens[0] = { ...tokens[0]!, revokedAt: "2026-01-03T00:00:00.000Z" };
        return new Response(null, { status: 204 });
      },
    },
    {
      initialValues: [
        [
          SettingsAtoms.clipboard,
          Layer.succeed(Clipboard.Clipboard)(
            Clipboard.make({
              read: Effect.succeed([]),
              readString: Effect.succeed(""),
              write: () => Effect.void,
              writeString: (text) => Effect.sync(() => void copied.push(text)),
            }),
          ),
        ],
      ],
    },
  );
  const wrapper = mount(SettingsPage, {
    attachTo: "body",
    global: { provide: { [AtomVue.registryKey]: registry } },
  });
  page = new DOMWrapper(wrapper.element.ownerDocument.body);
  await settle();
  return { wrapper, calls, copied };
};

const click = async (selector: string) => {
  await body().find(selector).trigger("click");
  await settle();
};

describe("settings page", () => {
  it("lists devices with their tokens", async () => {
    const { wrapper } = await mountPage();
    const devices = wrapper.findAll("[data-test=device]");
    expect(devices).toHaveLength(1);
    expect(devices[0]?.text()).toContain("Work laptop");
    expect(devices[0]?.findAll("[data-test=token]")).toHaveLength(1);
  });

  it("creates a device and shows its token exactly once", async () => {
    const { wrapper, calls } = await mountPage();
    const plaintext = Fixtures.plaintext("t2");

    await click("[data-test=add-device]");
    await body().find("input[name=name]").setValue("  iPhone  ");
    await body().find("select[name=kind]").setValue("ios");
    await body().find("form").trigger("submit");
    await settle();

    expect(calls).toEqual(["register iPhone ios", "create token d2"]);
    expect(body().find("[data-test=token-plaintext]").text()).toBe(plaintext);
    // The add-device form gave way to the token.
    expect(body().find("form").exists()).toBe(false);

    await click("[data-test=dismiss-token]");

    expect(body().html()).not.toContain(plaintext);
    // The new device and its token are listed, without the plaintext.
    const devices = wrapper.findAll("[data-test=device]");
    expect(devices.map((device) => device.find("h3, [data-slot=card-title]").text())).toEqual([
      expect.stringContaining("Work laptop"),
      expect.stringContaining("iPhone"),
    ]);
    expect(devices[1]?.findAll("[data-test=token]")).toHaveLength(1);

    // Opening the form again starts empty and shows no old token.
    await click("[data-test=add-device]");
    expect(body().html()).not.toContain(plaintext);
  });

  it("copies the token through the platform Clipboard", async () => {
    const { copied } = await mountPage();
    await click("[data-test=new-token]");
    await click("[data-test=copy-token]");
    expect(copied).toEqual([Fixtures.plaintext("t2")]);
    expect(body().find("[data-test=copy-token]").text()).toBe("Copied");
  });

  it("revokes a token only after confirming", async () => {
    const { wrapper, calls } = await mountPage();

    await click("[data-test=revoke-token]");
    expect(body().find("[role=alertdialog]").text()).toContain("Work laptop");
    await click("[data-test=cancel-revoke]");
    expect(calls).toEqual([]);
    expect(body().find("[role=alertdialog]").exists()).toBe(false);

    await click("[data-test=revoke-token]");
    await click("[data-test=confirm-revoke]");

    expect(calls).toEqual(["revoke t1"]);
    expect(body().find("[role=alertdialog]").exists()).toBe(false);
    const token = wrapper.find("[data-test=token]");
    expect(token.text()).toContain("Revoked");
    expect(token.find("[data-test=revoke-token]").exists()).toBe(false);
  });

  it("shows an empty state without devices", async () => {
    registry = ApiTesting.makeRegistry({
      "GET /devices": () => ApiTesting.json([]),
      "GET /tokens": () => ApiTesting.json([]),
    });
    const wrapper = mount(SettingsPage, {
      global: { provide: { [AtomVue.registryKey]: registry } },
    });
    await settle();
    expect(wrapper.text()).toContain("No devices yet");
  });
});
