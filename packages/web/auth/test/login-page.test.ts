import * as AtomVue from "@effect/atom-vue";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as ApiTesting from "@stash/web-api-client/testing";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
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
const mountPage = async (answers: ReadonlyArray<() => Response>) => {
  const polls: Array<number> = [];
  const copied: Array<string> = [];
  let startedAt = 0;
  let starts = 0;
  registry = ApiTesting.makeRegistry(
    {
      "POST /auth/device/start": () => {
        starts++;
        startedAt = Date.now();
        return ApiTesting.json({ ...started, flowId: `flow-${starts}` });
      },
      "POST /auth/device/poll": () => {
        polls.push((Date.now() - startedAt) / 1000);
        const answer = answers[Math.min(polls.length, answers.length) - 1]!;
        return answer();
      },
    },
    {
      initialValues: [
        [
          DeviceLoginAtoms.clipboard,
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
      ...Routes.routes,
    ],
  });
  await router.push("/login");
  const wrapper = mount(LoginPage, {
    global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
  });
  await settle();
  return { wrapper, router, polls, copied, starts: () => starts };
};

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
    ["LoginNotAllowed", "can't sign in", "Use another account"],
  ])("shows a clear state for %s", async (tag, message, action) => {
    const { wrapper, router } = await mountPage([error(tag, 403)]);
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await wait(5);

    expect(wrapper.find("[role=alert]").text()).toContain(message);
    expect(wrapper.find("[data-test=restart]").text()).toBe(action);
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("offers to try again when the api can't be reached", async () => {
    const { wrapper } = await mountPage([() => new Response("oops", { status: 500 })]);
    await wrapper.find("[data-test=sign-in]").trigger("click");
    await settle();
    await wait(5);
    expect(wrapper.find("[data-test=restart]").text()).toBe("Try again");
  });
});

describe("remaining", () => {
  it("formats the time left as m:ss and stops at 0:00", () => {
    expect(DeviceLoginAtoms.remaining(900_000, 0)).toBe("15:00");
    expect(DeviceLoginAtoms.remaining(65_000, 500)).toBe("1:05");
    expect(DeviceLoginAtoms.remaining(0, 1000)).toBe("0:00");
  });
});
