import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import { enableAutoUnmount, flushPromises, mount, RouterLinkStub } from "@vue/test-utils";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ConnectAtoms from "../src/connect-atoms.ts";
import ConnectExtensionPage from "../src/pair/connect-extension-page.vue";
import { fakeApi } from "./fake-api.ts";

enableAutoUnmount(afterEach);

let registry: AtomRegistry.AtomRegistry | undefined;
afterEach(() => {
  registry?.dispose();
  registry = undefined;
});

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const code = "c".repeat(43);

const mountPage = async (props: { code: string | undefined }, api = fakeApi()) => {
  registry = ApiTesting.makeRegistry(api.routes);
  const wrapper = mount(ConnectExtensionPage, {
    props,
    global: { provide: { [AtomVue.registryKey]: registry }, stubs: { RouterLink: RouterLinkStub } },
  });
  await settle();
  return { wrapper, api };
};

describe("Connect extension page", () => {
  it("approves the extension's code for a new Zen device, then waits for it", async () => {
    const { wrapper, api } = await mountPage({ code });
    await wrapper.find("input[name=name]").setValue("  Work Zen ");
    await wrapper.find("form").trigger("submit");
    await settle();

    expect(wrapper.find("[data-test=check-code]").text()).toBe("cccc");
    expect(api.calls).toEqual([`approve ${code} device-1 Work Zen`]);
    expect(wrapper.find("[data-test=approved]").text()).toContain("Work Zen");
    expect(wrapper.find("[data-test=waiting]").exists()).toBe(true);

    api.arrive("device-1", new Date(Date.now() + 1000).toISOString());
    await vi.waitFor(
      () =>
        expect(wrapper.find("[data-test=arrived]").text()).toBe(
          "Connected ✓ — the extension signed in",
        ),
      { timeout: ConnectAtoms.pollMillis * 2 },
    );
  });

  it("says when the code was already used", async () => {
    const api = fakeApi();
    const { wrapper } = await mountPage(
      { code },
      {
        ...api,
        routes: {
          ...api.routes,
          "POST /pairings": () =>
            ApiTesting.json({ _tag: "Conflict", message: "This pairing code is used" }, 409),
        },
      },
    );
    await wrapper.find("form").trigger("submit");
    await settle();
    expect(wrapper.find("[role=alert]").text()).toContain("already used");
    expect(api.devices).toEqual([]);
  });

  it("asks for a code when it has none", async () => {
    const { wrapper, api } = await mountPage({ code: "short" });
    expect(wrapper.text()).toContain("No pairing code");
    expect(wrapper.find("form").exists()).toBe(false);
    expect(api.calls).toEqual([]);
  });
});
