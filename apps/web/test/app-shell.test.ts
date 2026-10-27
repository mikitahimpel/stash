import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as PlatformTesting from "@stash/web-platform/testing";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Layer from "effect/Layer";
import { createMemoryHistory } from "vue-router";
import AppLayout from "../src/app-layout.vue";
import * as AppRegistry from "../src/app-registry.ts";
import * as AppRouter from "../src/app-router.ts";
import * as AppShortcuts from "../src/app-shortcuts.ts";
import * as ThemeAtoms from "@stash/web-settings/theme-atoms";

enableAutoUnmount(afterEach);

// The stub api answers `me` as signed in, or with 401 when `signedIn` is false.
const stubApi = (signedIn = true) =>
  ApiTesting.layer({
    "GET /auth/me": () =>
      signedIn ? ApiTesting.json({ kind: "user" }) : ApiTesting.unauthorized(),
  });

// The real theme logic on a simulated page, with an empty in-memory store.
const theme = () =>
  PlatformTesting.layerTheme().pipe(Layer.provide(PlatformTesting.layerKeyValueStore));

// In-memory platform layers. `keyboard` and `network` are built once, so the test drives the same
// instances the app runs on.
const platform = (signedIn = true) => {
  const keyboard = Layer.build(PlatformTesting.layerKeyboard).pipe(Effect.scoped, Effect.runSync);
  const network = Layer.build(PlatformTesting.layerNetwork()).pipe(Effect.scoped, Effect.runSync);
  const registry = AppRegistry.make({
    transport: stubApi(signedIn),
    theme: theme(),
    keyboard: Layer.succeedContext(keyboard),
    network: Layer.succeedContext(network),
  });
  return { registry, keyboard, network };
};

const mountApp = async (path = "/", signedIn = true) => {
  const { registry, keyboard, network } = platform(signedIn);
  const router = AppRouter.make(createMemoryHistory(), registry);
  await router.push(path);
  const wrapper = mount(AppLayout, {
    global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
  });
  await flushPromises();
  return { wrapper, router, registry, keyboard, network };
};

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect);

describe("app router", () => {
  it.each([
    ["/links", "links"],
    ["/links/link-1", "link-details"],
    ["/search", "search"],
    ["/open-now", "open-tabs"],
    ["/settings", "settings"],
  ])("resolves %s to the %s feature route", (path, name) => {
    const router = AppRouter.make(
      createMemoryHistory(),
      AppRegistry.make({ transport: stubApi() }),
    );
    expect(router.resolve(path).name).toBe(name);
  });

  it("redirects / and unknown paths to links", async () => {
    const router = AppRouter.make(
      createMemoryHistory(),
      AppRegistry.make({ transport: stubApi() }),
    );
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
    expect(labels).toEqual([["Inbox", "Open now", "Search", "Settings"]]);
    expect(wrapper.find("main h1").text()).toBe("Inbox");
  });

  it.each([
    ["/links", "Inbox"],
    ["/links/link-1", "Inbox"],
    ["/open-now", "Open now"],
    ["/search", "Search"],
    ["/settings", "Settings"],
  ])("marks the section of %s as the current page", async (path, label) => {
    const { wrapper } = await mountApp(path);
    const current = wrapper.findAll("nav[aria-label=Main] a[aria-current=page]");
    expect(current.map((a) => a.text())).toEqual([label]);
  });

  it("shows the network state as the sync status", async () => {
    const { wrapper, network } = await mountApp();
    const status = wrapper.find("[data-testid=sync-status]");
    expect(status.text()).toBe("online");
    await run(Context.get(network, PlatformTesting.TestNetwork).setOnline(false));
    await vi.waitFor(() => expect(status.text()).toBe("offline"));
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

describe("shortcuts", () => {
  const press = (
    keyboard: ReturnType<typeof platform>["keyboard"],
    key: { key: string; metaKey?: boolean; ctrlKey?: boolean; typing?: boolean },
  ) => run(Context.get(keyboard, PlatformTesting.TestKeyboard).press(key));
  const focused = (keyboard: ReturnType<typeof platform>["keyboard"]) =>
    run(Context.get(keyboard, PlatformTesting.TestKeyboard).focused);

  it.each([
    ["⌘K", { key: "k", metaKey: true }],
    ["Ctrl+K", { key: "k", ctrlKey: true }],
  ])("%s navigates to search and focuses its field", async (_, key) => {
    const { router, keyboard } = await mountApp("/links");
    expect(await press(keyboard, key)).toBe(true);
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("search"), {
      timeout: 10_000,
    });
    await vi.waitFor(async () =>
      expect(await focused(keyboard)).toEqual([AppShortcuts.pageSearchField]),
    );
  });

  it("the Search button navigates to search and focuses its field", async () => {
    const { wrapper, router, keyboard } = await mountApp("/links");
    await wrapper.find("button[aria-keyshortcuts]").trigger("click");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("search"), {
      timeout: 10_000,
    });
    await vi.waitFor(async () =>
      expect(await focused(keyboard)).toEqual([AppShortcuts.pageSearchField]),
    );
  });

  it("/ focuses the page's field without navigating, unless typing", async () => {
    const { router, keyboard } = await mountApp("/open-now");
    expect(await press(keyboard, { key: "/", typing: true })).toBe(false);
    expect(await press(keyboard, { key: "k" })).toBe(false);
    expect(await press(keyboard, { key: "/" })).toBe(true);
    await vi.waitFor(async () =>
      expect(await focused(keyboard)).toEqual([AppShortcuts.pageSearchField]),
    );
    expect(router.currentRoute.value.name).toBe("open-tabs");
  });

  it("stops listening once the shell unmounts", async () => {
    const { wrapper, keyboard } = await mountApp("/links");
    wrapper.unmount();
    await vi.waitFor(async () => expect(await press(keyboard, { key: "/" })).toBe(false));
  });
});

describe("theme toggle", () => {
  it("cycles system → light → dark → system through the theme service", async () => {
    const { wrapper, registry } = await mountApp("/links");
    const toggle = () => wrapper.find("button[aria-label^='Theme:']");
    expect(toggle().attributes("aria-label")).toBe("Theme: system");
    for (const [preference, scheme] of [
      ["light", "light"],
      ["dark", "dark"],
      ["system", "light"],
    ] as const) {
      await toggle().trigger("click");
      await vi.waitFor(() =>
        expect(registry.get(ThemeAtoms.state)).toMatchObject({
          _tag: "Success",
          value: { preference, scheme },
        }),
      );
      await flushPromises();
      expect(toggle().attributes("aria-label")).toBe(`Theme: ${preference}`);
    }
  });
});

describe("ui gallery", () => {
  it("opens /_ui in dev without a session and outside the app layout", async () => {
    const { wrapper, router } = await mountApp("/_ui", false);
    await vi.waitFor(() => expect(wrapper.find("h1").text()).toBe("stash / ui"), {
      timeout: 10_000,
    });
    expect(router.currentRoute.value.name).toBe("ui-gallery");
    expect(wrapper.find("nav[aria-label=Main]").exists()).toBe(false);
  });

  it("switches the theme from the gallery", async () => {
    const { registry } = platform(false);
    const router = AppRouter.make(createMemoryHistory(), registry);
    await router.push("/_ui");
    const wrapper = mount(AppLayout, {
      global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
    });
    await vi.waitFor(() => expect(wrapper.find("[role=radiogroup]").exists()).toBe(true), {
      timeout: 10_000,
    });
    const dark = wrapper
      .findAll("[aria-label=Theme] [role=radio]")
      .find((el) => el.text() === "Dark");
    await dark?.trigger("click");
    await vi.waitFor(() =>
      expect(registry.get(ThemeAtoms.state)).toMatchObject({
        _tag: "Success",
        value: { preference: "dark", scheme: "dark" },
      }),
    );
  });
});
