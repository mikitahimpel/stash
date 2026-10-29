import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as PlatformTesting from "@stash/web-platform/testing";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Layer from "effect/Layer";
import { nextTick } from "vue";
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
      expect(wrapper.find("main button").text()).toBe("Sign in with GitHub");
    },
  );

  it("renders the page when signed in", async () => {
    const { wrapper, router } = await mountApp("/settings");
    expect(router.currentRoute.value.name).toBe("settings");
    expect(wrapper.find("main h1").text()).toBe("Settings");
  });
});

describe("login gate", () => {
  const user = () => ApiTesting.json({ kind: "user" });

  const mountWith = async (routes: ApiTesting.Routes, path: string) => {
    const registry = AppRegistry.make({ transport: ApiTesting.layer(routes), theme: theme() });
    const router = AppRouter.make(createMemoryHistory(), registry);
    await router.push(path);
    const wrapper = mount(AppLayout, {
      global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
    });
    await flushPromises();
    return { wrapper, router };
  };

  it("sends /open-now to the login page with a return URL when /auth/me answers 401", async () => {
    const { wrapper, router } = await mountWith(
      { "GET /auth/me": () => ApiTesting.unauthorized() },
      "/open-now",
    );
    expect(router.currentRoute.value.fullPath).toBe("/login?redirect=/open-now");
    expect(wrapper.find("nav").exists()).toBe(false);
  });

  it("goes to the login page when GET /tabs answers 401 while /auth/me is cached as ok", async () => {
    const { wrapper, router } = await mountWith(
      { "GET /auth/me": user, "GET /tabs": () => ApiTesting.unauthorized() },
      "/open-now",
    );
    await vi.waitFor(
      () => expect(router.currentRoute.value.fullPath).toBe("/login?redirect=/open-now"),
      { timeout: 10_000 },
    );
    // It stays there, even though `me` still says signed in.
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("login");
    await vi.waitFor(() =>
      expect(wrapper.find("[data-test=sign-in]").text()).toBe("Sign in with GitHub"),
    );
  });
});

describe("cached pages", () => {
  afterEach(() => vi.useRealTimers());

  const tabs = {
    devices: [
      {
        device: {
          id: "laptop",
          name: "Laptop",
          kind: "zen",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        snapshot: {
          deviceId: "laptop",
          takenAt: "2026-01-10T12:00:00.000Z",
          tabs: [
            {
              url: "https://example.com/a",
              title: "Example a",
              openedAt: "2026-01-10T11:00:00.000Z",
              lastSeenAt: "2026-01-10T12:00:00.000Z",
            },
          ],
        },
      },
    ],
  };

  it("shows cached rows at once on a second visit, without a skeleton", async () => {
    let requests = 0;
    let respond: () => void = () => {};
    const registry = AppRegistry.make({
      transport: ApiTesting.layer({
        "GET /auth/me": () => ApiTesting.json({ kind: "user" }),
        "GET /tabs": () => {
          // The first load answers at once; later ones wait for `respond`.
          if (++requests === 1) return ApiTesting.json(tabs);
          return Effect.promise(
            () =>
              new Promise<Response>((resolve) => (respond = () => resolve(ApiTesting.json(tabs)))),
          );
        },
        "GET /devices": () => ApiTesting.json([]),
        "GET /tokens": () => ApiTesting.json([]),
      }),
      theme: theme(),
    });
    const router = AppRouter.make(createMemoryHistory(), registry);
    await router.push("/open-now");
    const wrapper = mount(AppLayout, {
      global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
    });
    const rows = () => wrapper.findAll("[data-slot=open-tab-title]").map((row) => row.text());
    await vi.waitFor(() => expect(rows()).toEqual(["Example a"]), { timeout: 10_000 });

    // A → B: Settings (loaded once, so its chunk is in place before the clock is faked).
    await router.push("/settings");
    await vi.waitFor(() => expect(wrapper.find("main h1").text()).toBe("Settings"), {
      timeout: 10_000,
    });

    // The user stays on B a moment, long enough for A's atoms to lose their last reader.
    await new Promise((resolve) => setTimeout(resolve, 300));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // B → A: the cached rows render at once, while the refresh runs behind them.
    await router.push("/open-now");
    await nextTick();
    expect(rows()).toEqual(["Example a"]);
    expect(wrapper.find("[data-slot=skeleton]").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(rows()).toEqual(["Example a"]);
    expect(wrapper.find("[data-slot=skeleton]").exists()).toBe(false);
    // Open now, then Settings (it reads the tabs too), then the background refresh.
    await vi.waitFor(() => expect(requests).toBe(3));
    respond();
    await flushPromises();
    expect(rows()).toEqual(["Example a"]);
    expect(wrapper.find("[data-slot=skeleton]").exists()).toBe(false);
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

describe("theme menu", () => {
  it("picks system, light or dark through the theme service", async () => {
    const { wrapper, registry } = await mountApp("/links");
    const trigger = () => wrapper.find("[data-test=theme-menu]");
    expect(trigger().attributes("aria-label")).toBe("Theme: system");
    for (const [preference, label, scheme] of [
      ["light", "Light", "light"],
      ["dark", "Dark", "dark"],
      ["system", "System", "light"],
    ] as const) {
      await trigger().trigger("keydown", { key: "Enter" });
      const body = new DOMWrapper(wrapper.element.ownerDocument.body);
      const options = body.findAll("[role=menuitemradio]");
      expect(options.map((option) => option.text())).toEqual(["System", "Light", "Dark"]);
      await options.find((option) => option.text() === label)?.trigger("click");
      await vi.waitFor(() =>
        expect(registry.get(ThemeAtoms.state)).toMatchObject({
          _tag: "Success",
          value: { preference, scheme },
        }),
      );
      await flushPromises();
      expect(trigger().attributes("aria-label")).toBe(`Theme: ${preference}`);
    }
  });
});

describe("header controls", () => {
  it("gives every icon-only control an accessible name and a tooltip", async () => {
    const { wrapper } = await mountApp("/links");
    const header = wrapper.find("header");
    const controls = header.findAll("button, a");
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const name = control.attributes("aria-label") ?? control.text();
      expect(name.trim(), control.html()).not.toBe("");
      // A control that shows only an icon explains itself on hover.
      if (control.find("svg").exists() && control.text().trim() === "") {
        expect(control.attributes("title"), control.html()).toBeTruthy();
      }
    }
  });

  it("opens Settings from the account menu", async () => {
    const { wrapper, router } = await mountApp("/links");
    await wrapper.find("[data-test=account-menu]").trigger("keydown", { key: "Enter" });
    const body = new DOMWrapper(wrapper.element.ownerDocument.body);
    const items = body.findAll("[role=menuitem]");
    expect(items.map((item) => item.text())).toEqual(["Settings", "Sign out"]);
    await items[0]?.trigger("click");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("settings"), {
      timeout: 10_000,
    });
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
