import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import OpenTabsPage from "../src/open-tabs-page.vue";
import * as Fixtures from "./fixtures.ts";

enableAutoUnmount(afterEach);

const mountPage = async (routes: ApiTesting.Routes) => {
  const registry = ApiTesting.makeRegistry(routes);
  const wrapper = mount(OpenTabsPage, {
    // Toasts teleport into <body>, so the page has to be attached to it.
    attachTo: "body",
    global: { provide: { [AtomVue.registryKey]: registry } },
  });
  await flushPromises();
  return wrapper;
};

/** Retries `check` until it passes: the stub api answers asynchronously. */
const eventually = (check: () => void) =>
  vi.waitFor(async () => {
    await flushPromises();
    check();
  });

const laptopAndPhone = () =>
  Fixtures.allTabs(
    Fixtures.deviceTabs("laptop", [
      // Ages count from the real clock, so the fresh tab opens relative to now.
      Fixtures.tab("a", new Date(Date.now() - 60 * 60_000).toISOString()),
      Fixtures.tab("b", "2025-12-01T00:00:00.000Z"),
    ]),
    Fixtures.deviceTabs("phone", null),
  );

const titles = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
  wrapper.findAll("[data-slot=open-tab]").map((row) => row.find("a span").text());

describe("open-tabs-page", () => {
  it("lists the tabs grouped by device with their age", async () => {
    const wrapper = await mountPage({ "GET /tabs": () => ApiTesting.json(laptopAndPhone()) });
    const devices = wrapper.findAll("[data-slot=device]");
    expect(devices.map((device) => device.find("h2").text().replace(/\s+/g, " "))).toEqual([
      "Device laptop · 2 tabs",
      "Device phone · 0 tabs",
    ]);
    expect(devices[1]?.text()).toContain("Never reported");
    expect(titles(wrapper)).toEqual(["Example a", "Example b"]);
    expect(
      wrapper
        .findAll("[data-slot=open-tab] [data-age]")
        .map((badge) => badge.attributes("data-age")),
    ).toEqual(["fresh", "old"]);
  });

  it("opens a tab in a new browser tab", async () => {
    const wrapper = await mountPage({ "GET /tabs": () => ApiTesting.json(laptopAndPhone()) });
    const link = wrapper.find("[data-slot=open-tab] a[aria-label='Open in a new tab']");
    expect(link.attributes()).toMatchObject({
      href: "https://example.com/a",
      target: "_blank",
      rel: "noopener noreferrer",
    });
  });

  it("removes an archived tab", async () => {
    let archived = 0;
    const wrapper = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /tabs/archive": () => {
        archived++;
        return ApiTesting.json(
          Fixtures.archived("laptop", "https://example.com/a", "Example a"),
          201,
        );
      },
    });
    await wrapper.find("[data-action=archive]").trigger("click");
    expect(titles(wrapper)).toEqual(["Example b"]);
    await eventually(() => expect(archived).toBe(1));
    await flushPromises();
    expect(titles(wrapper)).toEqual(["Example b"]);
  });

  it("brings a tab back and shows a toast when closing it fails", async () => {
    let respond: () => void = () => {};
    const responded = new Promise<void>((resolve) => (respond = resolve));
    const wrapper = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /devices/:id/commands": (_, { id }) =>
        Effect.promise(() =>
          responded.then(() => ApiTesting.json({ _tag: "NotFound", resource: "device", id }, 404)),
        ),
    });
    await wrapper.findAll("[data-action=close]")[1]?.trigger("click");
    expect(titles(wrapper)).toEqual(["Example a"]);
    respond();
    await eventually(() => expect(titles(wrapper)).toEqual(["Example a", "Example b"]));
    // The toast is teleported to <body>, outside the wrapper.
    await eventually(() =>
      expect(wrapper.element.ownerDocument.body.textContent).toContain("Couldn't close the tab"),
    );
  });

  it("shows an empty state without devices", async () => {
    const wrapper = await mountPage({ "GET /tabs": () => ApiTesting.json(Fixtures.allTabs()) });
    expect(wrapper.find("[data-state=empty]").text()).toContain("No devices yet");
  });

  it("shows an error state when the tabs can't load", async () => {
    const wrapper = await mountPage({ "GET /tabs": () => ApiTesting.unauthorized() });
    await eventually(() => expect(wrapper.find("[data-state=error]").exists()).toBe(true));
  });
});
