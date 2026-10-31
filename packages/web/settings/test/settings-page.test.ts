import * as AtomVue from "@effect/atom-vue";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as PlatformTesting from "@stash/web-platform/testing";
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "../src/settings-page.vue";
import * as SettingsAtoms from "../src/settings-atoms.ts";
import * as ThemeAtoms from "../src/theme-atoms.ts";
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

// The real theme logic on a simulated page, with an empty in-memory store.
const theme = () =>
  PlatformTesting.layerTheme().pipe(Layer.provide(PlatformTesting.layerKeyValueStore));

const mountPage = async (props: { startAdding?: boolean } = {}) => {
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
      "GET /tabs": () => ApiTesting.json(Fixtures.reports([["d1", "2026-01-05T00:00:00.000Z"]])),
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
        [ThemeAtoms.layer, theme()],
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
    props,
    global: { provide: { [AtomVue.registryKey]: registry } },
  });
  page = new DOMWrapper(wrapper.element.ownerDocument.body);
  await settle();
  // Under load the stub can take more turns than `settle` gives it.
  await vi.waitFor(() => expect(wrapper.find("[aria-busy=true]").exists()).toBe(false));
  return { wrapper, calls, copied };
};

const click = async (selector: string) => {
  await body().find(selector).trigger("click");
  await settle();
};

/** The input that shows the plaintext, if any. */
const plaintextField = () => body().find<HTMLInputElement>("[data-test=token-plaintext]");

describe("settings page", () => {
  it("opens the Add device dialog on arrival from ?add=device", async () => {
    await mountPage({ startAdding: true });
    expect(body().find("[role=dialog]").text()).toContain("Add");
  });

  it("stays closed otherwise", async () => {
    await mountPage();
    expect(body().find("[role=dialog]").exists()).toBe(false);
  });

  it("lists devices and tokens", async () => {
    const { wrapper } = await mountPage();
    const devices = wrapper.findAll("[data-test=device]");
    expect(devices).toHaveLength(1);
    expect(devices[0]?.text()).toContain("Work laptop");
    expect(devices[0]?.text()).toContain("Zen");
    const tokens = wrapper.findAll("[data-test=token]");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.text()).toContain("Work laptop");
    expect(tokens[0]?.text()).toContain("created 2026-01-02");
  });

  it("switches the theme through the theme service", async () => {
    const { wrapper } = await mountPage();
    const segment = (label: string) =>
      wrapper.findAll("[aria-label=Theme] [role=radio]").find((el) => el.text() === label)!;
    expect(segment("System").attributes("aria-checked")).toBe("true");

    await segment("Dark").trigger("click");
    await vi.waitFor(() =>
      expect(registry!.get(ThemeAtoms.state)).toMatchObject({
        _tag: "Success",
        value: { preference: "dark", scheme: "dark" },
      }),
    );
    await settle();
    expect(segment("Dark").attributes("aria-checked")).toBe("true");

    await segment("Light").trigger("click");
    await vi.waitFor(() =>
      expect(registry!.get(ThemeAtoms.state)).toMatchObject({
        _tag: "Success",
        value: { preference: "light", scheme: "light" },
      }),
    );
  });

  it("creates a device and shows its token once, then clears it on close", async () => {
    const { wrapper, calls } = await mountPage();
    const plaintext = Fixtures.plaintext("t2");

    await click("[data-test=add-device]");
    await body().find("input[name=name]").setValue("  iPhone  ");
    const ios = body()
      .findAll("[aria-label=Kind] [role=radio]")
      .find((el) => el.text() === "iPhone");
    await ios?.trigger("click");
    await body().find("form").trigger("submit");
    await settle();

    expect(calls).toEqual(["register iPhone ios", "create token d2"]);
    expect(plaintextField().element.value).toBe(plaintext);
    expect(plaintextField().attributes("readonly")).toBeDefined();
    expect(body().find("[data-test=token-warning]").text()).toContain("only once");
    // The add-device form gave way to the token.
    expect(body().find("form").exists()).toBe(false);

    await click("[data-test=dismiss-token]");

    expect(plaintextField().exists()).toBe(false);
    expect(body().html()).not.toContain(plaintext);
    expect(AsyncResult.isInitial(registry!.get(SettingsAtoms.issueToken))).toBe(true);
    // The new device and its token are listed, without the plaintext.
    expect(wrapper.findAll("[data-test=device-name]").map((el) => el.text())).toEqual([
      "Work laptop",
      "iPhone",
    ]);
    expect(wrapper.findAll("[data-test=token]").map((el) => el.text())).toEqual([
      expect.stringContaining("Work laptop"),
      expect.stringContaining("iPhone"),
    ]);

    // Opening the form again starts empty and shows no old token.
    await click("[data-test=add-device]");
    expect(body().find<HTMLInputElement>("input[name=name]").element.value).toBe("");
    expect(plaintextField().exists()).toBe(false);
  });

  it("clears the token when the dialog is closed with Escape", async () => {
    await mountPage();
    await click("[data-test=new-token]");
    expect(plaintextField().element.value).toBe(Fixtures.plaintext("t2"));

    await body().find("[role=dialog]").trigger("keydown", { key: "Escape" });
    await settle();

    expect(plaintextField().exists()).toBe(false);
    expect(AsyncResult.isInitial(registry!.get(SettingsAtoms.issueToken))).toBe(true);
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
    expect(token.find("[data-test=revoked]").text()).toBe("revoked 2026-01-03");
    expect(token.find("[data-test=revoke-token]").exists()).toBe(false);
  });

  it("shows an empty state without devices", async () => {
    registry = ApiTesting.makeRegistry(
      {
        "GET /devices": () => ApiTesting.json([]),
        "GET /tokens": () => ApiTesting.json([]),
        "GET /tabs": () => ApiTesting.json({ devices: [] }),
      },
      { initialValues: [[ThemeAtoms.layer, theme()]] },
    );
    const wrapper = mount(SettingsPage, {
      global: { provide: { [AtomVue.registryKey]: registry } },
    });
    await settle();
    expect(wrapper.text()).toContain("No devices");
    expect(wrapper.text()).toContain("No tokens");
  });
});
