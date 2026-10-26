import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import AppLayout from "../src/app-layout.vue";
import * as AppRegistry from "../src/app-registry.ts";
import * as AppRouter from "../src/app-router.ts";

enableAutoUnmount(afterEach);

// The stub api answers `me` as signed in, or with 401 when `signedIn` is false.
const stubApi = (signedIn = true) =>
  ApiTesting.layer({
    "GET /auth/me": () =>
      signedIn ? ApiTesting.json({ kind: "user" }) : ApiTesting.unauthorized(),
  });

const mountApp = async (path = "/", signedIn = true) => {
  const registry = AppRegistry.make(stubApi(signedIn));
  const router = AppRouter.make(createMemoryHistory(), registry);
  await router.push(path);
  const wrapper = mount(AppLayout, {
    global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
  });
  await flushPromises();
  return { wrapper, router };
};

describe("app router", () => {
  it.each([
    ["/links", "links"],
    ["/links/link-1", "link-details"],
    ["/search", "search"],
    ["/open-now", "open-tabs"],
    ["/settings", "settings"],
  ])("resolves %s to the %s feature route", (path, name) => {
    const router = AppRouter.make(createMemoryHistory(), AppRegistry.make(stubApi()));
    expect(router.resolve(path).name).toBe(name);
  });

  it("redirects / and unknown paths to links", async () => {
    const router = AppRouter.make(createMemoryHistory(), AppRegistry.make(stubApi()));
    await router.push("/");
    expect(router.currentRoute.value.name).toBe("links");
    await router.push("/no/such/page");
    expect(router.currentRoute.value.name).toBe("links");
  });
});

describe("auth guard", () => {
  it.each(["/links", "/search", "/open-now", "/settings"])(
    "redirects %s to the login page when logged out",
    async (path) => {
      const { wrapper, router } = await mountApp(path, false);
      expect(router.currentRoute.value.name).toBe("login");
      expect(wrapper.find("nav").exists()).toBe(false);
      expect(wrapper.find("a").text()).toBe("Sign in with GitHub");
    },
  );

  it("renders the page when signed in", async () => {
    const { wrapper, router } = await mountApp("/settings");
    expect(router.currentRoute.value.name).toBe("settings");
    expect(wrapper.find("main h1").text()).toBe("Settings");
  });
});

describe("app shell", () => {
  it("mounts with the nav and the current page", async () => {
    const { wrapper } = await mountApp();
    const labels = wrapper.findAll("nav").map((nav) => nav.findAll("a").map((a) => a.text()));
    expect(labels).toEqual([
      ["Links", "Search", "Open now", "Settings"],
      ["Links", "Search", "Open now", "Settings"],
    ]);
    expect(wrapper.find("main h1").text()).toBe("Links");
  });

  it("navigates when a nav link is clicked", async () => {
    const { wrapper, router } = await mountApp();
    const search = wrapper.findAll("nav a").find((a) => a.text() === "Search");
    await search?.trigger("click");
    // The search page is lazy-loaded, and its first import can take longer than a flush.
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/search"), {
      timeout: 10_000,
    });
    await flushPromises();
    expect(wrapper.find("main h1").text()).toBe("Search");
  });
});
