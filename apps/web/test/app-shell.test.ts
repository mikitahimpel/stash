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

// The accessible name of a control: `aria-label`, or its text without the aria-hidden parts.
const accessibleName = (control: DOMWrapper<Element>) => {
  const label = control.attributes("aria-label");
  if (label !== undefined) return label;
  const clone = control.element.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll("[aria-hidden=true]")) hidden.remove();
  return (clone.textContent ?? "").trim();
};

const body = (wrapper: { element: Element }) => new DOMWrapper(wrapper.element.ownerDocument.body);

const openAccountMenu = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.find("[data-test=account-menu]").trigger("keydown", { key: "Enter" });
  await flushPromises();
};

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect);

describe("app router", () => {
  it.each([
    ["/links", "links"],
    ["/links/link-1", "link-details"],
    ["/open-now", "open-tabs"],
    ["/settings", "settings"],
    ["/connect/extension", "connect-extension"],
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

  it.each([
    ["/search", "/links"],
    ["/search?q=rust", "/links?q=rust"],
    ["/connect", "/settings#connections"],
    ["/connect?guide=mac", "/settings?guide=mac#connections"],
  ])("takes the old address %s to %s", async (from, to) => {
    const { router } = await mountApp(from);
    expect(router.currentRoute.value.fullPath).toBe(to);
  });
});

describe("auth guard", () => {
  it.each([
    "/links",
    "/search",
    "/open-now",
    "/connect",
    "/settings",
    "/save?url=https://example.com/a",
  ])("redirects %s to the login page when logged out", async (path) => {
    const { wrapper, router } = await mountApp(path, false);
    expect(router.currentRoute.value.name).toBe("login");
    expect(wrapper.find("nav").exists()).toBe(false);
    expect(wrapper.find("main button").text()).toBe("Sign in with GitHub");
  });

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

  it("sends a signed-out /save through the login page and back, then saves the link once", async () => {
    let signedIn = false;
    const saved: Array<unknown> = [];
    const path = "/save?device=device-ios&url=https://example.com/a?b=1&c=2";
    const { wrapper, router } = await mountWith(
      {
        "GET /auth/me": () => (signedIn ? user() : ApiTesting.unauthorized()),
        "POST /auth/device/start": () =>
          ApiTesting.json({
            flowId: "flow-1",
            userCode: "WDJB-MJHT",
            verificationUri: "https://github.com/login/device",
            expiresIn: 900,
            interval: 1,
          }),
        "POST /auth/device/poll": () => {
          signedIn = true;
          return ApiTesting.json({ status: "complete", me: { kind: "user" } });
        },
        "POST /links": (request) =>
          Effect.map(
            Effect.sync(() =>
              request.body._tag === "Uint8Array"
                ? JSON.parse(new TextDecoder().decode(request.body.body))
                : null,
            ),
            (body) => {
              saved.push(body);
              return ApiTesting.json(
                {
                  id: "link-1",
                  url: "https://example.com/a?b=1&c=2",
                  canonicalUrl: null,
                  title: null,
                  status: "new",
                  type: null,
                  summary: null,
                  language: null,
                  tags: [],
                  sourceDeviceId: "device-ios",
                  createdAt: new Date().toISOString(),
                  imageUrl: null,
                  author: null,
                  enrichedAt: null,
                  created: true,
                },
                201,
              );
            },
          ),
      },
      path,
    );
    expect(router.currentRoute.value.name).toBe("login");
    expect(router.currentRoute.value.query["redirect"]).toBe(path);
    expect(saved).toEqual([]);

    await wrapper.find("[data-test=sign-in]").trigger("click");
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(path), {
      timeout: 10_000,
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain("Saved ✓"), { timeout: 10_000 });
    expect(saved).toEqual([{ url: "https://example.com/a?b=1&c=2", deviceId: "device-ios" }]);
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

describe("header tabs", () => {
  const tabs = { devices: [] };
  const mountWithTabs = async (path: string) => {
    const requests = { tabs: 0 };
    const registry = AppRegistry.make({
      transport: ApiTesting.layer({
        "GET /auth/me": () => ApiTesting.json({ kind: "user" }),
        "GET /tabs": () => {
          requests.tabs++;
          return ApiTesting.json(tabs);
        },
        "GET /devices": () => ApiTesting.json([]),
        "GET /tokens": () => ApiTesting.json([]),
        "GET /links": () => ApiTesting.json({ items: [], nextCursor: null }),
      }),
      theme: theme(),
    });
    const router = AppRouter.make(createMemoryHistory(), registry);
    await router.push(path);
    const wrapper = mount(AppLayout, {
      global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
    });
    await flushPromises();
    return { wrapper, router, requests };
  };
  const tab = (wrapper: ReturnType<typeof mount>, label: string) =>
    wrapper.findAll("nav a").find((link) => accessibleName(link) === label)!;

  it.each(["pointerenter", "touchstart", "focus"])(
    "loads a tab's first data on %s, before the click",
    async (event) => {
      const { wrapper, requests } = await mountWithTabs("/links");
      await vi.waitFor(() => expect(wrapper.find("main h1").text()).toBe("Inbox"), {
        timeout: 10_000,
      });
      expect(requests.tabs).toBe(0);
      await tab(wrapper, "Open now").trigger(event);
      await vi.waitFor(() => expect(requests.tabs).toBe(1), { timeout: 10_000 });
      // The page that opens right after shows what the hover loaded, without asking again.
      await tab(wrapper, "Open now").trigger("click");
      await vi.waitFor(() => expect(wrapper.find("main h1").text()).toBe("Open now"), {
        timeout: 10_000,
      });
      await flushPromises();
      expect(requests.tabs).toBe(1);
    },
  );

  it("opens a tab where it was left, and another page at its top", async () => {
    const scrolled: Array<number> = [];
    // The test's page, without naming the global the app must not use.
    const page = globalThis as unknown as Window;
    const scrollTo = vi.spyOn(page, "scrollTo").mockImplementation(((
      ...args: [ScrollToOptions] | [number, number]
    ) => {
      scrolled.push(typeof args[0] === "number" ? (args[1] ?? 0) : (args[0].top ?? 0));
    }) as Window["scrollTo"]);
    const scrollY = vi.spyOn(page, "scrollY", "get");
    try {
      const { router } = await mountWithTabs("/open-now");
      // Down the page, then away: Settings starts at its top.
      scrollY.mockReturnValue(640);
      await router.push("/settings");
      await vi.waitFor(() => expect(scrolled.at(-1)).toBe(0));
      // Back by the tab (not by the history): Open now is where it was left.
      scrollY.mockReturnValue(0);
      await router.push("/open-now");
      await vi.waitFor(() => expect(scrolled.at(-1)).toBe(640));
      // And Settings, left at its top, opens at its top.
      await router.push("/settings");
      await vi.waitFor(() => expect(scrolled.at(-1)).toBe(0));
    } finally {
      scrollTo.mockRestore();
      scrollY.mockRestore();
    }
  });
});

describe("app shell", () => {
  it("mounts with the nav and the current page", async () => {
    const { wrapper } = await mountApp();
    const labels = wrapper.findAll("nav").map((nav) => nav.findAll("a").map(accessibleName));
    expect(labels).toEqual([["Inbox", "Open now", "Settings"]]);
    expect(wrapper.find("main h1").text()).toBe("Inbox");
  });

  it.each([
    ["/links", "Inbox"],
    ["/links/link-1", "Inbox"],
    ["/open-now", "Open now"],
    ["/links?q=rust", "Inbox"],
    ["/settings", "Settings"],
    ["/connect?guide=iphone", "Settings"],
    [`/connect/extension?code=${"c".repeat(43)}`, "Settings"],
  ])("marks the section of %s as the current page", async (path, label) => {
    const { wrapper } = await mountApp(path);
    const current = wrapper.findAll("nav[aria-label=Main] a[aria-current=page]");
    expect(current.map(accessibleName)).toEqual([label]);
  });

  it("keeps the sync status in the account menu, and marks the button when offline", async () => {
    const { wrapper, network } = await mountApp();
    const attention = () => wrapper.find("[data-test=account-attention]");
    expect(wrapper.find("header").text()).not.toContain("online");
    expect(attention().exists()).toBe(false);
    await openAccountMenu(wrapper);
    const status = body(wrapper).find("[data-testid=sync-status]");
    expect(status.text()).toBe("Online");
    await run(Context.get(network, PlatformTesting.TestNetwork).setOnline(false));
    await vi.waitFor(() => expect(status.text()).toBe("Offline"));
    expect(attention().exists()).toBe(true);
    expect(wrapper.find("[data-test=account-menu]").attributes("aria-label")).toBe(
      "Account (offline)",
    );
  });

  it("navigates when a nav link is clicked", async () => {
    const { wrapper, router } = await mountApp();
    const settings = wrapper.findAll("nav a").find((a) => accessibleName(a) === "Settings");
    await settings?.trigger("click");
    // The page is lazy-loaded, and its first import can take longer than a flush.
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/settings"), {
      timeout: 10_000,
    });
    await flushPromises();
    expect(wrapper.find("main h1").text()).toBe("Settings");
  });

  it("opens the guide of /connect?guide=… in the first section of Settings", async () => {
    const { wrapper, router } = await mountApp("/connect?guide=claude");
    await vi.waitFor(() => expect(wrapper.find("main h1").text()).toBe("Settings"), {
      timeout: 10_000,
    });
    const sections = wrapper.findAll("main section").map((el) => el.attributes("aria-label"));
    expect(sections).toEqual(["Devices & connections", "API tokens", "Appearance"]);
    expect(wrapper.find("section#connections").exists()).toBe(true);
    expect(router.currentRoute.value.query).toEqual({ guide: "claude" });
  });
});

describe("header search", () => {
  const field = (wrapper: ReturnType<typeof mount>) =>
    wrapper.find<HTMLInputElement>("header input[type=search]");

  it.each(["/links", "/open-now", "/settings", "/links/link-1"])(
    "is one field in the header of %s",
    async (path) => {
      const { wrapper } = await mountApp(path);
      expect(wrapper.findAll("header form[role=search] input[type=search]")).toHaveLength(1);
      expect(field(wrapper).attributes("aria-label")).toBe("Search links");
    },
  );

  it("typing on another page opens the Inbox with the query, and its results", async () => {
    const registry = AppRegistry.make({
      transport: ApiTesting.layer({
        "GET /auth/me": () => ApiTesting.json({ kind: "user" }),
        "GET /links": () => ApiTesting.json({ items: [], nextCursor: null }),
        "GET /devices": () => ApiTesting.json([]),
        "GET /search": () =>
          ApiTesting.json({
            hits: [
              {
                score: 1,
                link: {
                  id: "link-1",
                  url: "https://example.com/rust",
                  canonicalUrl: null,
                  title: "Rust in anger",
                  status: "new",
                  type: "article",
                  summary: null,
                  language: "en",
                  tags: [],
                  sourceDeviceId: null,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  imageUrl: null,
                  author: null,
                  enrichedAt: "2026-01-01T00:01:00.000Z",
                },
              },
            ],
          }),
      }),
      theme: theme(),
      recentSearches: PlatformTesting.layerRecentSearches,
    });
    const router = AppRouter.make(createMemoryHistory(), registry);
    await router.push("/settings");
    const wrapper = mount(AppLayout, {
      global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
    });
    await flushPromises();

    await field(wrapper).setValue("rust");
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/links?q=rust"), {
      timeout: 10_000,
    });
    await vi.waitFor(
      () =>
        expect(wrapper.find("main [data-slot=search-summary]").text()).toBe("1 result for “rust”"),
      { timeout: 10_000 },
    );
    expect(wrapper.find("main h1").text()).toBe("Inbox");
    expect(wrapper.find("main [data-slot=match-mark]").text()).toBe("Rust");
    expect(field(wrapper).element.value).toBe("rust");

    // Clearing the field gives the Inbox back.
    await field(wrapper).setValue("");
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/links"), {
      timeout: 10_000,
    });
    await vi.waitFor(() =>
      expect(wrapper.find("main [data-slot=search-summary]").exists()).toBe(false),
    );
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
    ["⌘K", "/open-now", { key: "k", metaKey: true }],
    ["Ctrl+K", "/settings", { key: "k", ctrlKey: true }],
    ["/", "/links", { key: "/" }],
  ])("%s focuses the header's search field on %s, without navigating", async (_, path, key) => {
    const { router, keyboard } = await mountApp(path);
    expect(await press(keyboard, key)).toBe(true);
    await vi.waitFor(async () =>
      expect(await focused(keyboard)).toEqual([AppShortcuts.searchField]),
    );
    expect(router.currentRoute.value.fullPath).toBe(path);
  });

  it("leaves / alone while typing, and plain keys always", async () => {
    const { keyboard } = await mountApp("/open-now");
    expect(await press(keyboard, { key: "/", typing: true })).toBe(false);
    expect(await press(keyboard, { key: "k" })).toBe(false);
    expect(await press(keyboard, { key: "k", metaKey: true, typing: true })).toBe(true);
  });

  it("stops listening once the shell unmounts", async () => {
    const { wrapper, keyboard } = await mountApp("/links");
    wrapper.unmount();
    await vi.waitFor(async () => expect(await press(keyboard, { key: "/" })).toBe(false));
  });
});

describe("theme switch", () => {
  it("picks system, light or dark from the account menu", async () => {
    const { wrapper, registry } = await mountApp("/links");
    for (const [preference, label, scheme] of [
      ["light", "Light", "light"],
      ["dark", "Dark", "dark"],
      ["system", "System", "light"],
    ] as const) {
      await openAccountMenu(wrapper);
      const options = body(wrapper).findAll("[role=menuitemradio]");
      expect(options.map((option) => option.text())).toEqual(["System", "Light", "Dark"]);
      await options.find((option) => option.text() === label)?.trigger("click");
      await vi.waitFor(() =>
        expect(registry.get(ThemeAtoms.state)).toMatchObject({
          _tag: "Success",
          value: { preference, scheme },
        }),
      );
      await flushPromises();
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

  it("has the wordmark, three tabs, the search field and one account menu", async () => {
    const { wrapper } = await mountApp("/links");
    const header = wrapper.find("header");
    const names = header.findAll("button, a").map(accessibleName);
    expect(names).toEqual(["stash", "Inbox", "Open now", "Settings", "Account"]);
    // Search is the field itself, with its shortcuts, not a tab.
    expect(header.findAll("input")).toHaveLength(1);
    expect(header.find("input[type=search]").attributes("aria-keyshortcuts")).toBe(
      "Meta+K Control+K /",
    );
    // The field sits between the nav and the account menu.
    const order = [...header.element.querySelectorAll("nav, form[role=search], button")].map(
      (el) => el.tagName,
    );
    expect(order).toEqual(["NAV", "FORM", "BUTTON"]);
  });

  it("holds the theme switch, the sync status and Sign out in the account menu", async () => {
    const { wrapper } = await mountApp("/links");
    await openAccountMenu(wrapper);
    const menu = body(wrapper).find("[role=menu]");
    expect(menu.findAll("[role=menuitemradio]")).toHaveLength(3);
    expect(menu.find("[data-testid=sync-status]").exists()).toBe(true);
    expect(menu.findAll("[role=menuitem]").map((item) => item.text())).toEqual(["Sign out"]);
  });

  it("shows the initial of the login on the account button", async () => {
    const registry = AppRegistry.make({
      transport: ApiTesting.layer({
        "GET /auth/me": () => ApiTesting.json({ kind: "user", login: "example-user" }),
      }),
      theme: theme(),
    });
    const router = AppRouter.make(createMemoryHistory(), registry);
    await router.push("/settings");
    const wrapper = mount(AppLayout, {
      global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
    });
    await vi.waitFor(() => expect(wrapper.find("[data-test=account-initial]").text()).toBe("E"));
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
