import * as AtomVue from "@effect/atom-vue";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as ApiTesting from "@stash/web-api-client/testing";
import type * as Invite from "@stash/contracts-domain/invite";
import * as WebPlatform from "@stash/web-platform/live";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import * as Effect from "effect/Effect";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import * as AuthAtoms from "../src/auth-atoms.ts";
import * as DeviceLoginAtoms from "../src/device-login-atoms.ts";
import LoginPage from "../src/login-page.vue";
import * as Routes from "../src/routes.ts";

enableAutoUnmount(afterEach);

// Fakes the clock and timers the polling waits on. `setImmediate` stays real: Effect's scheduler
// runs on it.
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
});

let registry: AtomRegistry.AtomRegistry | undefined;
afterEach(() => {
  registry?.dispose();
  registry = undefined;
  vi.useRealTimers();
});

const started = {
  flowId: "flow-1",
  userCode: "WDJB-MJHT",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
  interval: 5,
};

const user = { kind: "user" };

/** Lets stub responses and Effect fibers settle without moving the fake clock. */
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
  }
};

/** Moves the fake clock by `seconds`, letting every poll due meanwhile run. */
const wait = async (seconds: number) => {
  for (let i = 0; i < seconds; i++) {
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
  }
};

// Mounts the login page against a stub api. `answers` are the `devicePoll` responses in order; the
// last one repeats. Every poll records the seconds since the flow started.
const mountPage = async (
  answers: ReadonlyArray<() => Response>,
  options: {
    readonly start?: () => Response;
    readonly path?: string;
    readonly clipboard?: Layer.Layer<Clipboard.Clipboard>;
    /** The invite of an invite link, and what the api says about it. */
    readonly invite?: string | null;
    readonly inviteCheck?: () => Response;
  } = {},
) => {
  const polls: Array<number> = [];
  const pollBodies: Array<unknown> = [];
  const checks: Array<unknown> = [];
  const copied: Array<string> = [];
  let startedAt = 0;
  let starts = 0;
  registry = ApiTesting.makeRegistry(
    {
      "POST /auth/device/start": () => {
        starts++;
        startedAt = Date.now();
        return options.start?.() ?? ApiTesting.json({ ...started, flowId: `flow-${starts}` });
      },
      "POST /invites/check": (request) => {
        checks.push(bodyOf(request));
        return (
          options.inviteCheck?.() ?? ApiTesting.json({ expiresAt: "2026-02-01T00:00:00.000Z" })
        );
      },
      "POST /auth/device/poll": (request) => {
        pollBodies.push(bodyOf(request));
        polls.push((Date.now() - startedAt) / 1000);
        const answer = answers[Math.min(polls.length, answers.length) - 1]!;
        return answer();
      },
    },
    {
      initialValues: [
        [
          DeviceLoginAtoms.clipboard,
          options.clipboard ??
            Layer.succeed(Clipboard.Clipboard)(
              Clipboard.make({
                read: Effect.succeed([]),
                readString: Effect.succeed(""),
                write: () => Effect.void,
                writeString: (text) => Effect.sync(() => void copied.push(text)),
              }),
            ),
        ],
      ],
    },
  );
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "links", component: { template: "<h1>Links</h1>" } },
      { path: "/open-now", name: "open-tabs", component: { template: "<h1>Open now</h1>" } },
      ...Routes.routes,
    ],
  });
  await router.push(options.path ?? "/login");
  const wrapper = mount(LoginPage, {
    ...(options.invite === undefined
      ? {}
      : { props: { invite: options.invite as Invite.InviteToken | null } }),
    global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
  });
  await settle();
  return {
    wrapper,
    router,
    registry: registry!,
    polls,
    pollBodies,
    checks,
    copied,
    starts: () => starts,
  };
};

/** The JSON a stubbed request was sent with. */
const bodyOf = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : {};

const pending = () => ApiTesting.json({ status: "pending" });
const slowDown = () => ApiTesting.json({ status: "slow_down" });
const complete = () => ApiTesting.json({ status: "complete", me: user });
const error = (tag: string, status: number) => () =>
  ApiTesting.json({ _tag: tag, message: tag }, status);

describe("login page", () => {
  it("starts a device flow and shows the code to copy", async () => {
    const { wrapper, copied } = await mountPage([pending]);
    expect(wrapper.find("[data-test=device-code]").exists()).toBe(false);

    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();

    expect(wrapper.find("[data-test=user-code]").text()).toBe("WDJB-MJHT");
    const link = wrapper.find("[data-test=verification-link]");
    expect(link.attributes("href")).toBe("https://github.com/login/device");
    expect(link.attributes("target")).toBe("_blank");
    expect(wrapper.find("[data-test=countdown]").text()).toBe("15:00");

    await wrapper.find("[data-test=copy-code]").trigger("click");
    await settle();
    expect(copied).toEqual(["WDJB-MJHT"]);
    expect(wrapper.find("[data-test=copy-code]").text()).toBe("Copied");
  });

  it("counts down to the expiry", async () => {
    const { wrapper } = await mountPage([pending]);
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await wait(61);
    expect(wrapper.find("[data-test=countdown]").text()).toBe("13:59");
  });

  it("polls at the server's interval, stops on complete and opens the app", async () => {
    const { wrapper, router, polls } = await mountPage([pending, pending, complete]);
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();

    await wait(4);
    expect(polls).toEqual([]);
    await wait(11);
    expect(polls).toEqual([5, 10, 15]);
    expect(router.currentRoute.value.name).toBe("links");

    await wait(30);
    expect(polls).toEqual([5, 10, 15]);
  });

  it("waits 5 seconds longer after slow_down", async () => {
    const { wrapper, polls } = await mountPage([slowDown, pending, slowDown, pending]);
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();

    await wait(5 + 10 + 10 + 15);
    // Intervals: 5, then 10 after the first slow_down, then 15 after the second.
    expect(polls).toEqual([5, 15, 25, 40]);
    expect(wrapper.find("[data-test=user-code]").exists()).toBe(true);
  });

  it("shows restart when the flow expired, and starts a new one", async () => {
    const { wrapper, polls, starts } = await mountPage([error("DeviceFlowExpired", 410)]);
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await wait(5);

    expect(polls).toEqual([5]);
    expect(wrapper.find("[data-test=user-code]").exists()).toBe(false);
    expect(wrapper.find("[role=alert]").text()).toContain("expired");
    const restart = wrapper.find("[data-test=restart]");
    expect(restart.text()).toBe("Get a new code");

    await wait(30);
    expect(polls).toEqual([5]);

    await restart.trigger("click");
    await settle();
    expect(starts()).toBe(2);
    expect(wrapper.find("[data-test=user-code]").text()).toBe("WDJB-MJHT");
  });

  it("expires on its own once the countdown ran out", async () => {
    const { wrapper, polls } = await mountPage([pending]);
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await vi.advanceTimersByTimeAsync(900_000);
    await wait(5);

    expect(polls).toHaveLength(179);
    expect(wrapper.find("[data-test=restart]").text()).toBe("Get a new code");
  });

  it.each([
    ["DeviceFlowDenied", "declined", "Try again"],
    ["LoginNotAllowed", "Ask its owner for an invite", "Use another account"],
  ])("shows a clear state for %s", async (tag, message, action) => {
    const { wrapper, router } = await mountPage([error(tag, 403)]);
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await wait(5);

    expect(wrapper.find("[role=alert]").text()).toContain(message);
    expect(wrapper.find("[data-test=restart]").text()).toBe(action);
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("returns to the page the user wanted once signed in", async () => {
    const {
      wrapper,
      router,
      registry: reg,
    } = await mountPage([complete], {
      path: "/login?redirect=/open-now",
    });
    reg.set(AuthAtoms.signedOut, true);
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await wait(5);
    expect(router.currentRoute.value.fullPath).toBe("/open-now");
    expect(reg.get(AuthAtoms.signedOut)).toBe(false);
  });

  it("says sign-in isn't configured when the api answers 503 NotConfigured", async () => {
    const { wrapper, polls } = await mountPage([pending], {
      start: () =>
        ApiTesting.json({ _tag: "NotConfigured", message: "GitHub login is not configured" }, 503),
    });
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await wait(5);
    const state = wrapper.find("[data-test=not-configured]");
    expect(state.text()).toContain("Sign-in isn't configured on this deployment yet.");
    expect(wrapper.find("[role=alert]").exists()).toBe(false);
    expect(wrapper.find("[data-test=sign-in]").exists()).toBe(false);
    expect(polls).toEqual([]);
  });

  it("shows the error and Retry when a poll can't reach the api", async () => {
    const { wrapper } = await mountPage([() => new Response("oops", { status: 500 })]);
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await wait(5);
    expect(wrapper.find("[role=alert]").text()).toContain("Couldn't reach stash");
    expect(wrapper.find("[data-test=error-detail]").text()).toBe("the api answered 500");
    expect(wrapper.find("[data-test=restart]").text()).toBe("Retry");
  });

  it("shows the error and Retry when the start fails, and Retry starts again", async () => {
    let fail = true;
    const { wrapper, starts } = await mountPage([pending], {
      start: () => (fail ? new Response("oops", { status: 502 }) : ApiTesting.json({ ...started })),
    });
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();

    expect(starts()).toBe(1);
    expect(wrapper.find("[data-test=user-code]").exists()).toBe(false);
    expect(wrapper.find("[role=alert]").text()).toContain("Couldn't reach stash");
    expect(wrapper.find("[data-test=error-detail]").text()).toBe("the api answered 502");
    const retry = wrapper.find("[data-test=restart]");
    expect(retry.text()).toBe("Retry");

    fail = false;
    await retry.trigger("click");
    await settle();
    expect(starts()).toBe(2);
    expect(wrapper.find("[data-test=user-code]").text()).toBe("WDJB-MJHT");
  });

  it("shows the code when the browser has no clipboard API, and says to copy by hand", async () => {
    // The live clipboard, on a browser without `navigator.clipboard` (iOS standalone, plain http).
    // happy-dom defines `clipboard` as a getter on the Navigator prototype, so an own property
    // shadows it and deleting that property restores it.
    const browser = globalThis.navigator;
    Object.defineProperty(browser, "clipboard", { value: undefined, configurable: true });
    try {
      const { wrapper } = await mountPage([pending], { clipboard: WebPlatform.layerClipboard });
      await wrapper.find("[data-test=sign-in]").trigger("click");
      await settle();
      expect(wrapper.find("[data-test=user-code]").text()).toBe("WDJB-MJHT");
      expect(wrapper.find("[data-test=verification-link]").attributes("target")).toBe("_blank");

      await wrapper.find("[data-test=copy-code]").trigger("click");
      await settle();
      expect(wrapper.find("[role=alert]").text()).toContain("copy it by hand");
      expect(wrapper.find("[data-test=user-code]").text()).toBe("WDJB-MJHT");
    } finally {
      Reflect.deleteProperty(browser, "clipboard");
    }
  });
});

describe("remaining", () => {
  it("formats the time left as m:ss and stops at 0:00", () => {
    expect(DeviceLoginAtoms.remaining(900_000, 0)).toBe("15:00");
    expect(DeviceLoginAtoms.remaining(65_000, 500)).toBe("1:05");
    expect(DeviceLoginAtoms.remaining(0, 1000)).toBe("0:00");
  });
});

// An invite link (`/invite/<token>`) opens the login page with the invite (#177).
describe("login page opened by an invite link", () => {
  const token = "t".repeat(43);

  it("is a public route that hands the token to the page, and only a well-formed one", () => {
    const route = Routes.routes.find((candidate) => candidate.name === Routes.invite);
    expect(route?.path).toBe("/invite/:token");
    expect(route?.meta).toEqual({ public: true });
    expect(Routes.inviteOf({ token })).toBe(token);
    expect(Routes.inviteOf({ token: "short" })).toBeUndefined();
    expect(Routes.inviteOf({ token: `${token}/../x` })).toBeUndefined();
  });

  it("says the visitor is invited and signs them up with the invite", async () => {
    const { wrapper, router, checks, pollBodies } = await mountPage([pending, complete], {
      invite: token,
    });
    expect(checks).toEqual([{ token }]);
    const line = wrapper.find("[data-test=invite]");
    expect(line.attributes("data-state")).toBe("open");
    expect(line.text()).toContain("You're invited");

    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await wait(10);
    // Every poll carries the invite: the api uses it when the account is new.
    expect(pollBodies).toEqual([
      { flowId: "flow-1", invite: token },
      { flowId: "flow-1", invite: token },
    ]);
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("says so when the invite no longer works, and still lets an existing account sign in", async () => {
    const { wrapper, pollBodies } = await mountPage([error("LoginNotAllowed", 403)], {
      invite: token,
      inviteCheck: () => ApiTesting.json({ _tag: "NotFound", resource: "invite", id: "" }, 404),
    });
    const line = wrapper.find("[data-test=invite]");
    expect(line.attributes("data-state")).toBe("closed");
    expect(line.attributes("role")).toBe("alert");
    expect(line.text()).toContain("no longer works");

    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await wait(5);
    expect(pollBodies).toEqual([{ flowId: "flow-1", invite: token }]);
    // An account without a Stash account is told the invite is the reason.
    expect(wrapper.find("[data-test=ended] [role=alert]").text()).toContain(
      "invite link no longer works",
    );
  });

  it("treats a malformed link as an invite that does not work, without asking the api", async () => {
    const { wrapper, checks, pollBodies } = await mountPage([pending], { invite: null });
    expect(checks).toEqual([]);
    expect(wrapper.find("[data-test=invite]").attributes("data-state")).toBe("closed");
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await wait(5);
    expect(pollBodies).toEqual([{ flowId: "flow-1" }]);
  });

  it("the plain login page shows no invite line and sends no invite", async () => {
    const { wrapper, checks, pollBodies } = await mountPage([pending]);
    expect(wrapper.find("[data-test=invite]").exists()).toBe(false);
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await wait(5);
    expect(checks).toEqual([]);
    expect(pollBodies).toEqual([{ flowId: "flow-1" }]);
  });
});
