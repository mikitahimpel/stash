import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import type * as Invite from "@stash/contracts-domain/invite";
import * as PageNavigation from "@stash/web-platform/page-navigation";
import * as WebTesting from "@stash/web-platform/testing";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import LoginPage from "../src/login-page.vue";
import * as Routes from "../src/routes.ts";
import * as SignInAtoms from "../src/sign-in-atoms.ts";

vi.mock("@stash/web-platform/page-navigation", () => ({ navigateTo: vi.fn() }));

enableAutoUnmount(afterEach);
let registry: AtomRegistry.AtomRegistry | undefined;
afterEach(() => {
  registry?.dispose();
  registry = undefined;
  vi.mocked(PageNavigation.navigateTo).mockClear();
});

const token = "t".repeat(43);
const challenge = { challengeId: "c".repeat(24), options: { challenge: "synthetic-challenge" } };
const credential = {
  id: "p".repeat(22),
  rawId: "p".repeat(22),
  type: "public-key",
  response: {},
  clientExtensionResults: {},
};
const signedIn = () => ApiTesting.json({ me: { kind: "user" } });

const bodyOf = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : {};

const mountPage = async (
  options: {
    readonly path?: string;
    readonly invite?: string;
    readonly google?: boolean;
    readonly authenticator?: "ok" | "Cancelled" | "none";
    readonly signIn?: () => Response;
  } = {},
) => {
  const sent: Array<{ route: string; body: unknown }> = [];
  const ceremonies: Array<unknown> = [];
  const record =
    (route: string, answer: () => Response) => (request: HttpClientRequest.HttpClientRequest) => {
      sent.push({ route, body: bodyOf(request) });
      return answer();
    };
  const answer = async (options_: unknown) => {
    ceremonies.push(options_);
    return options.authenticator === "Cancelled" ? ("Cancelled" as const) : credential;
  };
  registry = ApiTesting.makeRegistry(
    {
      "GET /auth/providers": () =>
        ApiTesting.json({ google: options.google ?? true, github: true }),
      "POST /invites/check": () => ApiTesting.json({ expiresAt: "2099-02-01T00:00:00.000Z" }),
      "POST /auth/passkey/options": record("options", () => ApiTesting.json(challenge)),
      "POST /auth/passkey/sign-in": record("sign-in", options.signIn ?? signedIn),
      "POST /auth/passkey/sign-up/options": record("sign-up/options", () =>
        ApiTesting.json(challenge),
      ),
      "POST /auth/passkey/sign-up": record("sign-up", signedIn),
    },
    {
      initialValues: [
        [
          SignInAtoms.passkeys,
          options.authenticator === "none"
            ? WebTesting.layerPasskeys()
            : WebTesting.layerPasskeys({ create: answer, get: answer }),
        ],
      ],
    },
  );
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "links", component: { template: "<h1>Links</h1>" } },
      { path: "/settings", name: "settings", component: { template: "<h1>Settings</h1>" } },
      ...Routes.routes,
    ],
  });
  await router.push(options.path ?? "/login");
  const wrapper = mount(LoginPage, {
    ...(options.invite === undefined
      ? {}
      : { props: { invite: options.invite as Invite.InviteToken } }),
    global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
  });
  await flushPromises();
  await flushPromises();
  return { wrapper, router, sent, ceremonies };
};

const settle = async () => {
  for (let i = 0; i < 5; i++) await flushPromises();
};

describe("login page: passkeys", () => {
  it("offers passkey first, then Google and GitHub", async () => {
    const { wrapper } = await mountPage();
    const buttons = wrapper.findAll("button").map((button) => button.text());
    expect(buttons).toEqual([
      "Continue with passkey",
      "Continue with Google",
      "Continue with GitHub",
    ]);
  });

  it("hides Google where it is not configured", async () => {
    const { wrapper } = await mountPage({ google: false });
    expect(wrapper.find("[data-test=google]").exists()).toBe(false);
    expect(wrapper.find("[data-test=passkey]").exists()).toBe(true);
  });

  it("signs in with one tap and no user name, then opens the page the user wanted", async () => {
    const { wrapper, router, sent, ceremonies } = await mountPage({
      path: "/login?redirect=/settings",
    });
    await wrapper.find("[data-test=passkey]").trigger("click");
    await settle();
    expect(ceremonies).toEqual([challenge.options]);
    expect(sent).toEqual([
      { route: "options", body: {} },
      { route: "sign-in", body: { challengeId: challenge.challengeId, credential } },
    ]);
    expect(router.currentRoute.value.fullPath).toBe("/settings");
  });

  it("returns to the MCP sign-in with a full page load", async () => {
    const back = "/authorize/session?state=synthetic-state";
    const { wrapper, router } = await mountPage({
      path: `/login?redirect=${encodeURIComponent(back)}`,
    });
    await wrapper.find("[data-test=passkey]").trigger("click");
    await settle();
    expect(PageNavigation.navigateTo).toHaveBeenCalledWith(back);
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("says nothing when the sheet is closed, and why when the passkey is not known", async () => {
    const cancelled = await mountPage({ authenticator: "Cancelled" });
    await cancelled.wrapper.find("[data-test=passkey]").trigger("click");
    await settle();
    expect(cancelled.wrapper.find("[data-test=sign-in-error]").exists()).toBe(false);
    expect(cancelled.sent.map((s) => s.route)).toEqual(["options"]);
    cancelled.wrapper.unmount();
    registry?.dispose();

    const unknown = await mountPage({
      signIn: () => ApiTesting.json({ _tag: "LoginNotAllowed", message: "x" }, 403),
    });
    await unknown.wrapper.find("[data-test=passkey]").trigger("click");
    await settle();
    expect(unknown.wrapper.find("[data-test=sign-in-error]").text()).toContain(
      "doesn't open an account",
    );
    expect(unknown.router.currentRoute.value.name).toBe("login");
  });

  it("says so in a browser without passkeys", async () => {
    const { wrapper } = await mountPage({ authenticator: "none" });
    await wrapper.find("[data-test=passkey]").trigger("click");
    await settle();
    expect(wrapper.find("[data-test=sign-in-error]").text()).toContain("can't use passkeys");
  });
});

describe("invite page", () => {
  it("says the visitor was invited, and makes a passkey for the new account", async () => {
    const { wrapper, router, sent } = await mountPage({ invite: token });
    expect(wrapper.find("[data-test=invite]").text()).toContain("You were invited to Stash");
    await wrapper.find("[data-test=passkey]").trigger("click");
    await settle();
    expect(sent).toEqual([
      { route: "sign-up/options", body: { invite: token } },
      { route: "sign-up", body: { challengeId: challenge.challengeId, invite: token, credential } },
    ]);
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("lets a member who already has an account sign in instead", async () => {
    const { wrapper, sent } = await mountPage({ invite: token });
    await wrapper.find("[data-test=passkey-sign-in]").trigger("click");
    await settle();
    expect(sent.map((s) => s.route)).toEqual(["options", "sign-in"]);
  });

  it("sends Google the invite, so a new Google account can join", async () => {
    const { wrapper } = await mountPage({ invite: token });
    await wrapper.find("[data-test=google]").trigger("click");
    expect(PageNavigation.navigateTo).toHaveBeenCalledWith(
      `https://api.example.com/auth/google/start?invite=${token}`,
    );
  });
});

describe("Sign in with Google", () => {
  it("leaves for the api's start route with the page to come back to", async () => {
    const { wrapper } = await mountPage({ path: "/login?redirect=/settings" });
    await wrapper.find("[data-test=google]").trigger("click");
    expect(PageNavigation.navigateTo).toHaveBeenCalledWith(
      "https://api.example.com/auth/google/start?redirect=%2Fsettings",
    );
  });

  it("shows why the callback did not sign anyone in", async () => {
    const { wrapper } = await mountPage({ path: "/login?signin=google_not_allowed" });
    expect(wrapper.find("[data-test=sign-in-error]").text()).toContain(
      "Ask its owner for an invite",
    );
  });
});

describe("isServerPath", () => {
  it.each([
    ["/authorize/session?state=x", true],
    ["/authorize", true],
    ["/api/auth/google/start", true],
    ["/authorized-apps", false],
    ["/settings", false],
  ])("%s → %s", (path, expected) => {
    expect(Routes.isServerPath(path)).toBe(expected);
  });
});
