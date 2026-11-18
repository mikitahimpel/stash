// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as OptionsActions from "../entrypoints/options/options-actions.ts";
import OptionsPage from "../entrypoints/options/options-page.vue";
import type * as OptionsView from "../entrypoints/options/options-view.ts";

// What only the page decides: that the normal path has one button and nothing to type, and that
// disconnecting takes a second, deliberate click. The address is invented.

enableAutoUnmount(afterEach);

const webOrigin = "https://stash.example.com";

const paired: OptionsView.View = {
  _tag: "Paired",
  webOrigin,
  deviceName: "Test browser",
  lastSave: { title: "A saved page", at: Date.now() - 5 * 60_000 },
  tabSync: { at: Date.now() - 60_000, tabs: 3 },
};

const mountPage = async (initial: OptionsView.View) => {
  let view = initial;
  let approve = (_result: { _tag: "Connected"; webOrigin: string }) => {};
  const actions = {
    load: vi.fn(async () => view),
    connect: vi.fn(
      (_origin: string, onCheck: (check: string) => void, signal: AbortSignal) =>
        new Promise<{ _tag: "Connected"; webOrigin: string }>((resolve, reject) => {
          onCheck("k3Xf");
          approve = resolve;
          signal.addEventListener("abort", () => reject(new Error("cancelled")));
        }),
    ),
    saveToken: vi.fn(async () => ({ _tag: "Failed" as const, message: "no" })),
    openStash: vi.fn(async () => {}),
    syncTabs: vi.fn(async () => ({ _tag: "Synced" as const })),
    disconnect: vi.fn(async () => {
      view = { _tag: "NotPaired", webOrigin };
    }),
  } satisfies OptionsActions.Actions;
  const wrapper = mount(OptionsPage, { props: { actions }, attachTo: "body" });
  await flushPromises();
  return {
    wrapper,
    actions,
    approve: async () => {
      view = paired;
      approve({ _tag: "Connected", webOrigin });
      await flushPromises();
    },
  };
};

describe("options page", () => {
  it("connects to the built-in Stash with one button and nothing to type", async () => {
    const { wrapper, actions, approve } = await mountPage({ _tag: "NotPaired", webOrigin });
    expect(wrapper.findAll("input")).toHaveLength(0);
    expect(wrapper.text()).toContain("stash.example.com");
    const connect = wrapper.find("button[name=connect]");
    expect(connect.text()).toBe("Connect to Stash");

    await connect.trigger("click");
    await flushPromises();
    expect(actions.connect).toHaveBeenCalledOnce();
    expect(actions.connect.mock.calls[0]?.[0]).toBe(webOrigin);
    // Waiting: the check code the Stash tab shows too, and no way to start a second pairing.
    expect(wrapper.find(".code").text()).toBe("k3Xf");
    expect(wrapper.find("button[name=connect]").exists()).toBe(false);
    expect(wrapper.find("button[name=other]").exists()).toBe(false);

    await approve();
    expect(wrapper.text()).toContain("Connected to Stash");
    expect(wrapper.text()).toContain("Test browser");
    expect(wrapper.text()).toContain("A saved page");
    expect(wrapper.text()).toContain("3 tabs in sync");
    for (const name of ["open-stash", "sync", "disconnect"]) {
      expect(wrapper.find(`button[name=${name}]`).exists(), name).toBe(true);
    }
  });

  it("cancels a pairing and returns to the Connect button", async () => {
    const { wrapper } = await mountPage({ _tag: "NotPaired", webOrigin });
    await wrapper.find("button[name=connect]").trigger("click");
    await flushPromises();
    await wrapper.find("button[name=cancel]").trigger("click");
    await flushPromises();
    expect(wrapper.find("button[name=connect]").exists()).toBe(true);
    expect(wrapper.find("[role=alert]").exists()).toBe(false);
  });

  it("keeps the address and the token by hand behind 'Use a different Stash'", async () => {
    const { wrapper, actions } = await mountPage({ _tag: "NotPaired", webOrigin });
    await wrapper.find("button[name=other]").trigger("click");
    expect(wrapper.findAll("input").map((input) => input.attributes("id"))).toEqual(["address"]);
    await wrapper.find("button[name=by-hand]").trigger("click");
    expect(wrapper.findAll("input").map((input) => input.attributes("id"))).toEqual([
      "address",
      "api-url",
      "token",
    ]);

    await wrapper.find("#address").setValue("other.example.com");
    await wrapper.find("#address").element.closest("form")?.dispatchEvent(new Event("submit"));
    await flushPromises();
    expect(actions.connect.mock.calls[0]?.[0]).toBe("other.example.com");
  });

  it("asks for the address when the build has no Stash", async () => {
    const { wrapper } = await mountPage({ _tag: "NotPaired", webOrigin: "" });
    expect(wrapper.find("button[name=connect]").exists()).toBe(false);
    expect(wrapper.find("#address").exists()).toBe(true);
  });

  it("disconnects only after a second click", async () => {
    const { wrapper, actions } = await mountPage(paired);
    await wrapper.find("button[name=disconnect]").trigger("click");
    expect(actions.disconnect).not.toHaveBeenCalled();
    // The focus is on Keep, so Enter keeps the connection.
    expect(wrapper.element.ownerDocument.activeElement?.textContent?.trim()).toBe("Keep");
    await wrapper.find("button[name=confirm-disconnect]").trigger("click");
    await flushPromises();
    expect(actions.disconnect).toHaveBeenCalledOnce();
    expect(wrapper.find("button[name=connect]").exists()).toBe(true);
  });

  it("says so when Stash is unreachable, and tries again", async () => {
    const { wrapper, actions } = await mountPage({ _tag: "Unreachable", webOrigin });
    expect(wrapper.find("[role=alert]").text()).toContain("did not answer");
    await wrapper.find("button[name=retry]").trigger("click");
    await flushPromises();
    expect(actions.load).toHaveBeenCalledTimes(2);
  });
});
