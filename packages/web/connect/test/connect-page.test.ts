import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as PlatformTesting from "@stash/web-platform/testing";
import {
  DOMWrapper,
  enableAutoUnmount,
  flushPromises,
  mount,
  RouterLinkStub,
} from "@vue/test-utils";
import * as Effect from "effect/Effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ConnectAtoms from "../src/connect-atoms.ts";
import type * as ConnectStatus from "../src/connect-status.ts";
import ConnectPage from "../src/connect-page.vue";
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

/** This deploy's static files: the extension's info, signed or not, or none (404). */
const downloads = (signed?: boolean) =>
  PlatformTesting.layerHttpClient((request) =>
    Effect.succeed(
      signed !== undefined &&
        new URL(request.url, "http://localhost").pathname === ConnectAtoms.extensionInfoPath
        ? Response.json({ signed })
        : new Response(null, { status: 404 }),
    ),
  );

const mountPage = async (guide?: ConnectStatus.Source, api = fakeApi(), signed?: boolean) => {
  registry = ApiTesting.makeRegistry(api.routes, {
    initialValues: [
      [ConnectAtoms.clipboard, PlatformTesting.layerClipboard],
      [ConnectAtoms.downloads, downloads(signed)],
    ],
  });
  const wrapper = mount(ConnectPage, {
    attachTo: "body",
    props: guide === undefined ? {} : { guide },
    global: { provide: { [AtomVue.registryKey]: registry }, stubs: { RouterLink: RouterLinkStub } },
  });
  await settle();
  await vi.waitFor(() => expect(wrapper.find("[data-source]").exists()).toBe(true));
  return { wrapper, api };
};

const value = (wrapper: { find: DOMWrapper<Element>["find"] }, label: string) =>
  wrapper.find<HTMLInputElement>(`input[aria-label="${label}"]`).element.value;

const recently = () => new Date(Date.now() + 1000).toISOString();

describe("Connect page", () => {
  it("lists the four sources, none connected, with no guide open", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.findAll("[data-source]").map((row) => row.attributes("data-source"))).toEqual([
      "iphone",
      "extension",
      "mac",
      "claude",
    ]);
    expect(wrapper.findAll("[data-test=status]").map((el) => el.text())).toEqual(
      Array(4).fill("Not connected"),
    );
    expect(wrapper.find("[data-guide]").exists()).toBe(false);
  });

  it("walks the iPhone guide: creates the device, prefills the Shortcut, waits for a save", async () => {
    const { wrapper, api } = await mountPage("iphone");
    expect(wrapper.find("[data-guide=iphone]").exists()).toBe(true);
    expect(wrapper.find<HTMLInputElement>("input[name=name]").element.value).toBe("iPhone");

    await wrapper.find("[data-guide=iphone] form").trigger("submit");
    await settle();

    expect(api.calls).toEqual(["register iPhone ios"]);
    expect(wrapper.find("[data-test=created]").text()).toContain("iPhone");
    expect(
      wrapper
        .findAll("[data-test=shortcut-mock] li")
        .map((row) => row.find("[data-slot=list-row-title]").text()),
    ).toEqual(["Receive URLs from Share Sheet", "Open URLs"]);
    expect(value(wrapper, "Shortcut URL")).toBe(
      "https://stash.example.com/save?device=device-1&url=",
    );
    expect(wrapper.find("[data-test=waiting]").text()).toBe("Waiting for your first save…");

    api.arrive("device-1", recently(), "A synthetic article");
    await vi.waitFor(
      () =>
        expect(wrapper.find("[data-test=arrived]").text()).toBe(
          "Connected ✓ — “A synthetic article” arrived",
        ),
      { timeout: ConnectAtoms.pollMillis * 2 },
    );
    expect(wrapper.find("[data-source=iphone] [data-test=status]").text()).toMatch(
      /^Connected · last save just now from iPhone$/,
    );
  });

  it("creates a token for the iPhone's advanced Shortcut", async () => {
    const { wrapper, api } = await mountPage("iphone");
    await wrapper.find("[data-guide=iphone] form").trigger("submit");
    await settle();
    await wrapper.find("[data-action=create-token]").trigger("click");
    await settle();

    expect(api.calls).toEqual(["register iPhone ios", "create token device-1"]);
    expect(value(wrapper, "API address")).toBe("https://stash.example.com/api/links");
    expect(value(wrapper, "Authorization header")).toBe("Bearer stash_synthetic_token-1");
    expect(value(wrapper, "Bookmarklet")).toContain("https://stash.example.com/save?title=");
  });

  it("copies a prefilled value", async () => {
    const { wrapper } = await mountPage("mac");
    await wrapper.find("[data-copy='Uninstall command'] [data-action=copy]").trigger("click");
    await settle();
    expect(wrapper.find("[data-copy='Uninstall command'] [data-action=copy]").text()).toBe(
      "Copied",
    );
  });

  it("walks the Mac guide: one install command with the new token", async () => {
    const { wrapper, api } = await mountPage("mac");
    await wrapper.find("[data-guide=mac] form").trigger("submit");
    await settle();

    expect(api.calls).toEqual(["register Mac mac-agent", "create token device-1"]);
    const command = value(wrapper, "Install command");
    expect(command).toContain("'https://stash.example.com/downloads/install-mac-agent.sh'");
    expect(command).toContain("STASH_DEVICE_TOKEN='stash_synthetic_token-1'");
    // The variant that asks for the token keeps it out of the shell history.
    expect(value(wrapper, "Install command without the token")).not.toContain("STASH_DEVICE_TOKEN");
    expect(value(wrapper, "Device token")).toBe("stash_synthetic_token-1");

    api.arrive("device-1", recently());
    await vi.waitFor(
      () =>
        expect(wrapper.find("[data-test=arrived]").text()).toBe(
          "Connected ✓ — the Mac agent checked in",
        ),
      { timeout: ConnectAtoms.pollMillis * 2 },
    );
  });

  it("offers the extension download from this deploy", async () => {
    const { wrapper } = await mountPage("extension", fakeApi(), true);
    expect(wrapper.find("[data-action=download]").attributes("href")).toBe(
      "https://stash.example.com/downloads/stash-extension.xpi",
    );
    expect(wrapper.find("[data-guide=extension]").attributes("data-signed")).toBe("true");
    expect(wrapper.find("[data-test=install]").text()).toContain("choose Add");
  });

  it.each([
    ["the build says it is unsigned", false],
    ["the build says nothing", undefined],
  ])("loads an unsigned extension as a temporary add-on when %s", async (_, signed) => {
    const { wrapper } = await mountPage("extension", fakeApi(), signed);
    expect(wrapper.find("[data-guide=extension]").attributes("data-signed")).toBe("false");
    const install = wrapper.find("[data-test=install]").text();
    expect(install).toContain("isn't signed by Mozilla");
    expect(install).toContain("Load Temporary Add-on");
    expect(value(wrapper, "Debugging page")).toBe("about:debugging#/runtime/this-firefox");
    expect(wrapper.find("[data-guide=extension]").text()).toContain(
      "xpinstall.signatures.required",
    );
  });

  it("shows Claude's connector URL and waits for Claude to use it", async () => {
    const { wrapper, api } = await mountPage("claude");
    expect(value(wrapper, "Connector URL")).toBe("https://mcp.example.com/mcp");

    api.useClaude(recently());
    await vi.waitFor(
      () =>
        expect(wrapper.find("[data-test=arrived]").text()).toBe("Connected ✓ — Claude used Stash"),
      { timeout: ConnectAtoms.pollMillis * 2 },
    );
  });

  it("says so when the deploy has no MCP server", async () => {
    const { wrapper } = await mountPage("claude", fakeApi(null));
    expect(wrapper.find("[data-guide=claude]").text()).toContain("no MCP server configured");
  });
});
