import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as PlatformTesting from "@stash/web-platform/testing";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as OpenTabsAtoms from "../src/open-tabs-atoms.ts";
import type * as OpenTabsView from "../src/open-tabs-view.ts";
import * as Fixtures from "./fixtures.ts";

let registry: AtomRegistry.AtomRegistry | undefined;
// Close on device sends at once here; the tests of its Undo set a delay of their own.
const use = (routes: ApiTesting.Routes) => {
  registry = ApiTesting.makeRegistry(routes);
  registry.set(OpenTabsAtoms.closeDelay, Duration.zero);
  return registry;
};
afterEach(() => {
  registry?.dispose();
  registry = undefined;
});

const body = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array"
    ? JSON.parse(new TextDecoder().decode(request.body.body))
    : undefined;

const laptop = () =>
  Fixtures.allTabs(Fixtures.deviceTabs("laptop", [Fixtures.tab("a"), Fixtures.tab("b")]));

/** The urls the view shows per device, or `undefined` while it isn't loaded. */
const shown = (reg: AtomRegistry.AtomRegistry) => {
  const view = reg.get(OpenTabsAtoms.view);
  return AsyncResult.isSuccess(view)
    ? view.value.map((group) => group.tabs.map((tab) => tab.url))
    : undefined;
};

const loaded = (reg: AtomRegistry.AtomRegistry) =>
  AtomRegistry.getResult(reg, OpenTabsAtoms.view, { suspendOnWaiting: true });

const rowOf = (reg: AtomRegistry.AtomRegistry, path: string): OpenTabsView.TabRow => {
  const view = reg.get(OpenTabsAtoms.view);
  const row = AsyncResult.isSuccess(view)
    ? view.value.flatMap((group) => group.tabs).find((tab) => tab.url.endsWith(`/${path}`))
    : undefined;
  if (row === undefined) throw new Error(`no row for ${path}`);
  return row;
};

/** A response the test releases by hand, to look at the optimistic state in between. */
const gate = () => {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, wait: (response: () => Response) => Effect.promise(() => opened.then(response)) };
};

describe("view", () => {
  it.effect("loads the tabs of every device", () =>
    Effect.gen(function* () {
      const reg = use({
        "GET /tabs": () =>
          ApiTesting.json(
            Fixtures.allTabs(
              Fixtures.deviceTabs("laptop", [Fixtures.tab("a")]),
              Fixtures.deviceTabs("phone", [Fixtures.tab("b")]),
            ),
          ),
      });
      const groups = yield* loaded(reg);
      expect(groups.map((group) => [group.device.name, group.tabs.length])).toEqual([
        ["Device laptop", 1],
        ["Device phone", 1],
      ]);
    }),
  );
});

describe("archive", () => {
  it.effect("hides the tab at once, posts it and refreshes the tabs", () =>
    Effect.gen(function* () {
      const response = gate();
      const posted: Array<unknown> = [];
      let lists = 0;
      const reg = use({
        "GET /tabs": () => {
          lists++;
          return ApiTesting.json(laptop());
        },
        "POST /tabs/archive": (request) => {
          posted.push(body(request));
          return response.wait(() =>
            ApiTesting.json(Fixtures.archived("laptop", "https://example.com/a", "Example a"), 201),
          );
        },
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);

      reg.set(OpenTabsAtoms.archive, rowOf(reg, "a"));
      expect(shown(reg)).toEqual([["https://example.com/b"]]);

      response.open();
      yield* AtomRegistry.getResult(reg, OpenTabsAtoms.archive, { suspendOnWaiting: true });
      expect(posted).toEqual([
        { deviceId: "laptop", url: "https://example.com/a", title: "Example a" },
      ]);
      // The refreshed snapshot predates the archive, so the tab stays hidden.
      yield* loaded(reg);
      expect(lists).toBe(2);
      expect(shown(reg)).toEqual([["https://example.com/b"]]);
      expect(reg.get(OpenTabsAtoms.toasts)).toEqual([]);
      unmount();
    }),
  );

  it.effect("omits a missing title", () =>
    Effect.gen(function* () {
      const posted: Array<unknown> = [];
      const reg = use({
        "GET /tabs": () =>
          ApiTesting.json(
            Fixtures.allTabs(
              Fixtures.deviceTabs("laptop", [{ ...Fixtures.tab("a"), title: null }]),
            ),
          ),
        "POST /tabs/archive": (request) => {
          posted.push(body(request));
          return ApiTesting.json(Fixtures.archived("laptop", "https://example.com/a", null), 201);
        },
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      reg.set(OpenTabsAtoms.archive, rowOf(reg, "a"));
      yield* AtomRegistry.getResult(reg, OpenTabsAtoms.archive, { suspendOnWaiting: true });
      expect(posted).toEqual([{ deviceId: "laptop", url: "https://example.com/a" }]);
      unmount();
    }),
  );

  it.effect("rolls back and shows a toast when the api rejects it", () =>
    Effect.gen(function* () {
      const response = gate();
      const reg = use({
        "GET /tabs": () => ApiTesting.json(laptop()),
        "POST /tabs/archive": () =>
          response.wait(() =>
            ApiTesting.json({ _tag: "NotFound", resource: "device", id: "laptop" }, 404),
          ),
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);

      reg.set(OpenTabsAtoms.archive, rowOf(reg, "a"));
      expect(shown(reg)).toEqual([["https://example.com/b"]]);

      response.open();
      const exit = yield* Effect.exit(
        AtomRegistry.getResult(reg, OpenTabsAtoms.archive, { suspendOnWaiting: true }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(shown(reg)).toEqual([["https://example.com/a", "https://example.com/b"]]);
      expect(reg.get(OpenTabsAtoms.toasts)).toMatchObject([
        { title: "Couldn't archive the tab", description: "Example a", variant: "destructive" },
      ]);
      unmount();
    }),
  );

  it.effect("rolls back when the request fails unexpectedly", () =>
    Effect.gen(function* () {
      const reg = use({
        "GET /tabs": () => ApiTesting.json(laptop()),
        "POST /tabs/archive": () => new Response("boom", { status: 500 }),
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      reg.set(OpenTabsAtoms.archive, rowOf(reg, "a"));
      const exit = yield* Effect.exit(
        AtomRegistry.getResult(reg, OpenTabsAtoms.archive, { suspendOnWaiting: true }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(shown(reg)).toEqual([["https://example.com/a", "https://example.com/b"]]);
      expect(reg.get(OpenTabsAtoms.toasts)).toHaveLength(1);
      unmount();
    }),
  );

  it.effect("runs actions on several tabs side by side", () =>
    Effect.gen(function* () {
      const response = gate();
      const posted: Array<unknown> = [];
      const reg = use({
        "GET /tabs": () => ApiTesting.json(laptop()),
        "POST /tabs/archive": (request) => {
          const payload = body(request) as { url: string };
          posted.push(payload.url);
          return response.wait(() =>
            ApiTesting.json(Fixtures.archived("laptop", payload.url, null), 201),
          );
        },
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      reg.set(OpenTabsAtoms.archive, rowOf(reg, "a"));
      reg.set(OpenTabsAtoms.archive, rowOf(reg, "b"));
      expect(shown(reg)).toEqual([[]]);
      response.open();
      yield* AtomRegistry.getResult(reg, OpenTabsAtoms.archive, { suspendOnWaiting: true });
      yield* loaded(reg);
      expect(posted).toEqual(["https://example.com/a", "https://example.com/b"]);
      expect(shown(reg)).toEqual([[]]);
      expect(reg.get(OpenTabsAtoms.toasts)).toEqual([]);
      unmount();
    }),
  );
});

describe("closeOnDevice", () => {
  it.effect("queues a close-tab command for the tab's device and hides the tab", () =>
    Effect.gen(function* () {
      const commands: Array<unknown> = [];
      const reg = use({
        "GET /tabs": () => ApiTesting.json(laptop()),
        "POST /devices/:id/commands": (request, { id }) => {
          commands.push({ id, payload: body(request) });
          return ApiTesting.json(Fixtures.command(id ?? "", "https://example.com/b"), 201);
        },
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      reg.set(OpenTabsAtoms.closeOnDevice, rowOf(reg, "b"));
      const command = yield* AtomRegistry.getResult(reg, OpenTabsAtoms.closeOnDevice, {
        suspendOnWaiting: true,
      });
      expect(command?.status).toBe("pending");
      expect(commands).toEqual([
        { id: "laptop", payload: { kind: "close-tab", url: "https://example.com/b" } },
      ]);
      yield* loaded(reg);
      expect(shown(reg)).toEqual([["https://example.com/a"]]);
      unmount();
    }),
  );

  it.effect("rolls back and shows a toast when the device is gone", () =>
    Effect.gen(function* () {
      const reg = use({
        "GET /tabs": () => ApiTesting.json(laptop()),
        "POST /devices/:id/commands": (_, { id }) =>
          ApiTesting.json({ _tag: "NotFound", resource: "device", id }, 404),
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      reg.set(OpenTabsAtoms.closeOnDevice, rowOf(reg, "b"));
      yield* Effect.exit(
        AtomRegistry.getResult(reg, OpenTabsAtoms.closeOnDevice, { suspendOnWaiting: true }),
      );
      expect(shown(reg)).toEqual([["https://example.com/a", "https://example.com/b"]]);
      const [toast] = reg.get(OpenTabsAtoms.toasts);
      expect(toast).toMatchObject({ title: "Couldn't close the tab", description: "Example b" });
      OpenTabsAtoms.dismissToast(reg, toast?.id ?? "");
      expect(reg.get(OpenTabsAtoms.toasts)).toEqual([]);
      unmount();
    }),
  );

  it.effect("waits with an Undo toast, and Undo brings the tab back and sends nothing", () =>
    Effect.gen(function* () {
      let sent = 0;
      const reg = use({
        "GET /tabs": () => ApiTesting.json(laptop()),
        "POST /devices/:id/commands": (_, { id }) => {
          sent += 1;
          return ApiTesting.json(Fixtures.command(id ?? "", "https://example.com/b"), 201);
        },
      });
      reg.set(OpenTabsAtoms.closeDelay, Duration.minutes(1));
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      reg.set(OpenTabsAtoms.closeOnDevice, rowOf(reg, "b"));
      expect(shown(reg)).toEqual([["https://example.com/a"]]);
      const [toast] = reg.get(OpenTabsAtoms.toasts);
      expect(toast).toMatchObject({
        title: "Closing on Device laptop",
        description: "Example b",
        action: "Undo",
      });

      OpenTabsAtoms.undoClose(reg, toast?.id ?? "");
      const command = yield* AtomRegistry.getResult(reg, OpenTabsAtoms.closeOnDevice, {
        suspendOnWaiting: true,
      });
      expect(command).toBeNull();
      expect(sent).toBe(0);
      expect(shown(reg)).toEqual([["https://example.com/a", "https://example.com/b"]]);
      expect(reg.get(OpenTabsAtoms.toasts)).toEqual([]);
      // Nothing waits any more: a second Undo is a no-op.
      OpenTabsAtoms.undoClose(reg, toast?.id ?? "");
      unmount();
    }),
  );

  it.effect("takes its Undo toast away once the command is sent", () =>
    Effect.gen(function* () {
      const reg = use({
        "GET /tabs": () => ApiTesting.json(laptop()),
        "POST /devices/:id/commands": (_, { id }) =>
          ApiTesting.json(Fixtures.command(id ?? "", "https://example.com/b"), 201),
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      reg.set(OpenTabsAtoms.closeOnDevice, rowOf(reg, "b"));
      yield* AtomRegistry.getResult(reg, OpenTabsAtoms.closeOnDevice, { suspendOnWaiting: true });
      expect(reg.get(OpenTabsAtoms.toasts)).toEqual([]);
      unmount();
    }),
  );

  it.effect("shows the tab again once a newer snapshot still reports it", () =>
    Effect.gen(function* () {
      let snapshotAt = Fixtures.takenAt;
      const reg = use({
        "GET /tabs": () =>
          ApiTesting.json(
            Fixtures.allTabs(
              Fixtures.deviceTabs("laptop", [Fixtures.tab("a"), Fixtures.tab("b")], snapshotAt),
            ),
          ),
        "POST /devices/:id/commands": (_, { id }) =>
          ApiTesting.json(Fixtures.command(id ?? "", "https://example.com/b"), 201),
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      reg.set(OpenTabsAtoms.closeOnDevice, rowOf(reg, "b"));
      yield* AtomRegistry.getResult(reg, OpenTabsAtoms.closeOnDevice, { suspendOnWaiting: true });
      yield* loaded(reg);
      expect(shown(reg)).toEqual([["https://example.com/a"]]);

      snapshotAt = new Date(Date.now() + 60_000).toISOString();
      reg.refresh(OpenTabsAtoms.tabs);
      yield* loaded(reg);
      expect(shown(reg)).toEqual([["https://example.com/a", "https://example.com/b"]]);
      unmount();
    }),
  );
});

describe("save, more tabs than one request carries", () => {
  it.effect("saves the first 500 and says how many are left", () =>
    Effect.gen(function* () {
      const sent: Array<number> = [];
      const reg = use({
        "GET /tabs": () =>
          ApiTesting.json(
            Fixtures.allTabs(
              Fixtures.deviceTabs(
                "laptop",
                Array.from({ length: 503 }, (_, index) => Fixtures.tab(`t${index}`)),
              ),
            ),
          ),
        "GET /links": () => ApiTesting.json(Fixtures.linksPage()),
        "POST /links/batch": (request) => {
          const { links } = body(request) as { links: ReadonlyArray<unknown> };
          sent.push(links.length);
          return ApiTesting.json({ links: [] }, 201);
        },
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      yield* AtomRegistry.getResult(reg, OpenTabsAtoms.recentLinks, { suspendOnWaiting: true });
      const view = reg.get(OpenTabsAtoms.view);
      const all = AsyncResult.isSuccess(view) ? view.value.flatMap((group) => group.tabs) : [];
      reg.set(OpenTabsAtoms.save, all);
      yield* AtomRegistry.getResult(reg, OpenTabsAtoms.save, { suspendOnWaiting: true });
      expect(sent).toEqual([500]);
      expect(reg.get(OpenTabsAtoms.toasts).at(-1)).toMatchObject({
        title: "Saved 500 tabs",
        description: "3 more are not saved yet: save again for the rest.",
      });
      unmount();
    }),
  );
});

const savedIds = (reg: AtomRegistry.AtomRegistry) => {
  const view = reg.get(OpenTabsAtoms.view);
  return AsyncResult.isSuccess(view)
    ? view.value.flatMap((group) => group.tabs.map((tab) => tab.saved?.id ?? null))
    : undefined;
};

describe("saved tabs", () => {
  it.effect("marks the tabs whose page is among the latest links", () =>
    Effect.gen(function* () {
      let asked = "";
      const reg = use({
        "GET /tabs": () => ApiTesting.json(laptop()),
        "GET /links": (request) => {
          asked = String(Object.fromEntries(request.urlParams)["limit"] ?? "");
          return ApiTesting.json(
            Fixtures.linksPage(Fixtures.link("link-b", "https://example.com/b/")),
          );
        },
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      yield* AtomRegistry.getResult(reg, OpenTabsAtoms.recentLinks, { suspendOnWaiting: true });
      expect(savedIds(reg)).toEqual([null, "link-b"]);
      expect(asked).toBe("100");
      unmount();
    }),
  );

  it.effect("shows the tabs when the links can't be loaded", () =>
    Effect.gen(function* () {
      const reg = use({
        "GET /tabs": () => ApiTesting.json(laptop()),
        "GET /links": () => new Response(null, { status: 500 }),
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      expect(savedIds(reg)).toEqual([null, null]);
      unmount();
    }),
  );
});

describe("save", () => {
  it.effect("saves one tab with its title and device, and marks it saved at once", () =>
    Effect.gen(function* () {
      const sent: Array<unknown> = [];
      const reg = use({
        "GET /tabs": () => ApiTesting.json(laptop()),
        "GET /links": () => ApiTesting.json(Fixtures.linksPage()),
        "POST /links": (request) => {
          sent.push(body(request));
          return ApiTesting.json(
            { ...Fixtures.link("link-a", "https://example.com/a"), created: true },
            201,
          );
        },
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      reg.set(OpenTabsAtoms.save, [rowOf(reg, "a")]);
      const count = yield* AtomRegistry.getResult(reg, OpenTabsAtoms.save, {
        suspendOnWaiting: true,
      });
      expect(count).toBe(1);
      expect(sent).toEqual([
        { url: "https://example.com/a", title: "Example a", deviceId: "laptop" },
      ]);
      expect(savedIds(reg)).toEqual(["link-a", null]);
      // The tab stays open: saving is not archiving.
      expect(shown(reg)).toEqual([["https://example.com/a", "https://example.com/b"]]);
      unmount();
    }),
  );

  it.effect("saves several tabs in one request, without the saved ones and repeats", () =>
    Effect.gen(function* () {
      const sent: Array<unknown> = [];
      const reg = use({
        "GET /tabs": () =>
          ApiTesting.json(
            Fixtures.allTabs(
              Fixtures.deviceTabs("laptop", [Fixtures.tab("a"), Fixtures.tab("b")]),
              Fixtures.deviceTabs("phone", [Fixtures.tab("b"), Fixtures.tab("c")]),
            ),
          ),
        "GET /links": () =>
          ApiTesting.json(Fixtures.linksPage(Fixtures.link("link-a", "https://example.com/a"))),
        "POST /links/batch": (request) => {
          sent.push(body(request));
          return ApiTesting.json(
            {
              links: [
                Fixtures.link("link-b", "https://example.com/b"),
                Fixtures.link("link-c", "https://example.com/c"),
              ],
            },
            201,
          );
        },
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      yield* AtomRegistry.getResult(reg, OpenTabsAtoms.recentLinks, { suspendOnWaiting: true });
      const view = reg.get(OpenTabsAtoms.view);
      const all = AsyncResult.isSuccess(view) ? view.value.flatMap((group) => group.tabs) : [];
      reg.set(OpenTabsAtoms.save, all);
      const count = yield* AtomRegistry.getResult(reg, OpenTabsAtoms.save, {
        suspendOnWaiting: true,
      });
      expect(count).toBe(2);
      expect(sent).toEqual([
        {
          links: [
            { url: "https://example.com/b", title: "Example b", deviceId: "laptop" },
            { url: "https://example.com/c", title: "Example c", deviceId: "phone" },
          ],
        },
      ]);
      expect(savedIds(reg)).toEqual(["link-a", "link-b", "link-b", "link-c"]);
      expect(reg.get(OpenTabsAtoms.toasts).map((toast) => toast.title)).toEqual(["Saved 2 tabs"]);
      unmount();
    }),
  );

  it.effect("says so in a toast when saving fails, and changes nothing", () =>
    Effect.gen(function* () {
      const reg = use({
        "GET /tabs": () => ApiTesting.json(laptop()),
        "GET /links": () => ApiTesting.json(Fixtures.linksPage()),
        "POST /links": () => ApiTesting.json({ _tag: "RateLimited" }, 429),
      });
      const unmount = reg.mount(OpenTabsAtoms.view);
      yield* loaded(reg);
      reg.set(OpenTabsAtoms.save, [rowOf(reg, "a")]);
      const exit = yield* Effect.exit(
        AtomRegistry.getResult(reg, OpenTabsAtoms.save, { suspendOnWaiting: true }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(reg.get(OpenTabsAtoms.toasts)).toMatchObject([
        { title: "Couldn't save the tab", description: "Example a", variant: "destructive" },
      ]);
      expect(savedIds(reg)).toEqual([null, null]);
      unmount();
    }),
  );
});

describe("copy", () => {
  it.effect("copies the tab's address and says so", () =>
    Effect.gen(function* () {
      const clipboard = yield* Layer.build(PlatformTesting.layerClipboard);
      registry = ApiTesting.makeRegistry(
        {},
        { initialValues: [[OpenTabsAtoms.clipboard, Layer.succeedContext(clipboard)]] },
      );
      registry.set(OpenTabsAtoms.copy, "https://example.com/a?x=1#top");
      yield* AtomRegistry.getResult(registry, OpenTabsAtoms.copy, { suspendOnWaiting: true });
      const text = yield* Effect.provide(
        Effect.flatMap(Clipboard.Clipboard, (service) => service.readString),
        clipboard,
      );
      expect(text).toBe("https://example.com/a?x=1#top");
      expect(registry.get(OpenTabsAtoms.toasts).map((toast) => toast.title)).toEqual([
        "Link copied",
      ]);
    }),
  );
});
