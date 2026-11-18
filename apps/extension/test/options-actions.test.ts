import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as OptionsActions from "../entrypoints/options/options-actions.ts";

// The pairing round trip of the options page, on the in-memory platform and a fake api: from a
// build that knows its Stash, through the approval, to the connected page and back out. The
// address, the device and the token are synthetic.

const builtIn = "https://stash.example.com";
const token = "stash_synthetic-paired-token";

const fakeApi = () => {
  const state = { approved: false, online: true, reports: 0 };
  const seen: Array<string> = [];
  const handler = (request: HttpClientRequest.HttpClientRequest) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api/, "");
      seen.push(`${request.method} ${url.origin}${url.pathname}`);
      if (!state.online) return new Response(null, { status: 503 });
      if (path === "/pairings/claim") {
        return state.approved
          ? Response.json(
              {
                id: "token-1",
                deviceId: "device-zen",
                name: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                revokedAt: null,
                lastUsedAt: null,
                token,
              },
              { status: 201 },
            )
          : Response.json({ _tag: "NotFound", resource: "pairing", id: "code" }, { status: 404 });
      }
      if (request.headers["authorization"] !== `Bearer ${token}`) {
        return Response.json({ _tag: "Unauthorized", message: "Invalid token" }, { status: 401 });
      }
      if (path === "/auth/me") return Response.json({ kind: "device", deviceId: "device-zen" });
      if (path === "/devices") {
        return Response.json([
          {
            id: "device-zen",
            name: "Zen on the desk",
            kind: "zen",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]);
      }
      if (path === "/devices/activity") {
        return Response.json([
          {
            deviceId: "device-zen",
            lastSeenAt: "2026-01-02T00:00:00.000Z",
            lastSave: {
              at: "2026-01-02T00:00:00.000Z",
              linkId: "link-a",
              url: "https://example.com/a",
              title: "A saved page",
            },
          },
        ]);
      }
      if (request.method === "PUT" && path === "/devices/device-zen/tabs") {
        state.reports += 1;
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    });
  return { state, seen, handler };
};

const optionsTab = Testing.tab({
  id: 1,
  url: "moz-extension://synthetic/options.html",
  active: true,
});

describe("options page: actions", () => {
  it("pairs with the built-in Stash without an address, shows the connection, disconnects", async () => {
    const api = fakeApi();
    const runtime = ManagedRuntime.make(
      Testing.make({
        tabs: [optionsTab, Testing.tab({ id: 2, url: "https://example.com/a" })],
        handler: api.handler,
      }),
    );
    const actions = OptionsActions.make(runtime, builtIn);

    // Not paired: the page offers the Stash the build came from.
    expect(await actions.load()).toEqual({ _tag: "NotPaired", webOrigin: builtIn });

    const checks: Array<string> = [];
    const connecting = actions.connect(
      builtIn,
      (check) => checks.push(check),
      new AbortController().signal,
    );
    const opened = await runtime.runPromise(
      Effect.gen(function* () {
        const tabs = yield* Testing.TestTabs;
        return (yield* tabs.all).at(-1);
      }),
    );
    expect(opened?.url).toMatch(
      /^https:\/\/stash\.example\.com\/connect\/extension\?code=[\w-]{43}$/,
    );
    expect(opened?.active).toBe(true);
    expect(checks).toEqual([new URL(opened?.url ?? "").searchParams.get("code")?.slice(0, 4)]);

    // The owner approves in the Stash tab; the next poll gets the token.
    api.state.approved = true;
    expect(await connecting).toEqual({ _tag: "Connected", webOrigin: builtIn });
    const active = await runtime.runPromise(
      Effect.gen(function* () {
        const tabs = yield* Testing.TestTabs;
        return (yield* tabs.all).filter((tab) => tab.active).map((tab) => tab.id);
      }),
    );
    // Back on the options page.
    expect(active).toEqual([optionsTab.id]);

    expect(await actions.load()).toEqual({
      _tag: "Paired",
      webOrigin: builtIn,
      deviceName: "Zen on the desk",
      lastSave: { title: "A saved page", at: Date.parse("2026-01-02T00:00:00.000Z") },
      tabSync: null,
    });

    expect(await actions.syncTabs()).toEqual({ _tag: "Synced" });
    expect(api.state.reports).toBe(1);
    expect(await actions.load()).toMatchObject({ _tag: "Paired", tabSync: { tabs: 2 } });
    // Asked for by hand, so unchanged tabs are sent again.
    expect(await actions.syncTabs()).toEqual({ _tag: "Synced" });
    expect(api.state.reports).toBe(2);

    // Every request went to the api under the built-in origin.
    expect(api.seen.every((it) => it.includes(` ${builtIn}/api/`))).toBe(true);

    api.state.online = false;
    expect(await actions.load()).toEqual({ _tag: "Unreachable", webOrigin: builtIn });
    expect(await actions.syncTabs()).toMatchObject({ _tag: "Failed" });
    api.state.online = true;

    await actions.disconnect();
    expect(await actions.load()).toEqual({ _tag: "NotPaired", webOrigin: builtIn });
    await runtime.dispose();
  }, 15_000);

  it("stops waiting when the page cancels", async () => {
    const api = fakeApi();
    const runtime = ManagedRuntime.make(Testing.make({ handler: api.handler }));
    const actions = OptionsActions.make(runtime, builtIn);
    const controller = new AbortController();
    const connecting = actions.connect(builtIn, () => {}, controller.signal);
    controller.abort();
    await expect(connecting).rejects.toBeDefined();
    expect(await actions.load()).toEqual({ _tag: "NotPaired", webOrigin: builtIn });
    await runtime.dispose();
  });

  it("a rejected token is not paired, and keeps the Stash it was for", async () => {
    const api = fakeApi();
    const runtime = ManagedRuntime.make(
      Testing.make({
        config: { apiBaseUrl: "https://other.example.com/api", deviceToken: "synthetic-revoked" },
        handler: api.handler,
      }),
    );
    const actions = OptionsActions.make(runtime, builtIn);
    expect(await actions.load()).toEqual({
      _tag: "NotPaired",
      webOrigin: "https://other.example.com",
    });
    await actions.openStash("https://other.example.com");
    const tabs = await runtime.runPromise(Effect.flatMap(Testing.TestTabs, (it) => it.all));
    expect(tabs.map((tab) => tab.url)).toEqual(["https://other.example.com/"]);
    await runtime.dispose();
  });
});
