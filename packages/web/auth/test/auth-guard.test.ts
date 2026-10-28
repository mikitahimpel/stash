import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as Unauthenticated from "@stash/web-api-client/unauthenticated";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import * as AuthGuard from "../src/auth-guard.ts";
import LogoutButton from "../src/logout-button.vue";
import * as Routes from "../src/routes.ts";

enableAutoUnmount(afterEach);

const user = () => ApiTesting.json({ kind: "user" });

const Page = { template: "<h1>Links</h1>" };

// A stub api whose `GET /auth/me` answers with whatever `session.me` is at the time.
const setup = (session: { me: () => Response }, routes: ApiTesting.Routes = {}) => {
  const registry = ApiTesting.makeRegistry({ "GET /auth/me": () => session.me(), ...routes });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", redirect: "/links" },
      { path: "/links", name: "links", component: Page },
      { path: "/search", name: "search", component: Page },
      { path: "/gallery", name: "gallery", component: Page, meta: { public: true } },
      ...Routes.routes,
    ],
  });
  const remove = AuthGuard.install(router, registry);
  return { registry, router, remove };
};

const mountApp = (
  registry: AtomRegistry.AtomRegistry,
  router: ReturnType<typeof setup>["router"],
) =>
  mount(RouterView, {
    global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
  });

describe("auth guard", () => {
  it("renders a guarded route when me succeeds", async () => {
    const { registry, router } = setup({ me: user });
    await router.push("/links");
    const wrapper = mountApp(registry, router);
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("links");
    expect(wrapper.find("h1").text()).toBe("Links");
    registry.dispose();
  });

  it("redirects a guarded route to the login page when me fails", async () => {
    const { registry, router } = setup({ me: () => ApiTesting.unauthorized() });
    await router.push("/links");
    const wrapper = mountApp(registry, router);
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("login");
    expect(wrapper.find("[data-test=sign-in]").text()).toBe("Sign in with GitHub");
    registry.dispose();
  });

  it("asks the api again on every navigation", async () => {
    const session = { me: user };
    const { registry, router } = setup(session);
    await router.push("/links");
    expect(router.currentRoute.value.name).toBe("links");
    session.me = () => ApiTesting.unauthorized();
    await router.push("/search");
    expect(router.currentRoute.value.name).toBe("login");
    registry.dispose();
  });

  it("lets navigation go on when the api can't tell", async () => {
    const { registry, router } = setup({ me: () => new Response("oops", { status: 500 }) });
    await router.push("/links");
    expect(router.currentRoute.value.name).toBe("links");
    registry.dispose();
  });

  it("sends a signed-in user away from the login page", async () => {
    const { registry, router } = setup({ me: user });
    await router.push("/login");
    expect(router.currentRoute.value.name).toBe("links");
    registry.dispose();
  });

  it.each([
    ["signed in", user],
    ["signed out", ApiTesting.unauthorized],
  ])("opens other public routes without redirecting when %s", async (_, me) => {
    const { router } = setup({ me });
    await router.push("/gallery");
    expect(router.currentRoute.value.name).toBe("gallery");
  });

  it("goes to the login page on any later 401", async () => {
    const session = { me: user };
    const { registry, router } = setup(session);
    await router.push("/links");
    session.me = () => ApiTesting.unauthorized();
    Unauthenticated.emit(registry);
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("login");
    registry.dispose();
  });

  it("stops guarding once removed", async () => {
    const { registry, router, remove } = setup({ me: () => ApiTesting.unauthorized() });
    remove();
    await router.push("/links");
    Unauthenticated.emit(registry);
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("links");
    registry.dispose();
  });
});

describe("logout", () => {
  it("ends the session and shows the login page", async () => {
    const session = { me: user };
    let loggedOut = 0;
    const { registry, router } = setup(session, {
      "POST /auth/logout": () => {
        loggedOut++;
        session.me = () => ApiTesting.unauthorized();
        return new Response(null, { status: 204 });
      },
    });
    await router.push("/links");
    const wrapper = mount(LogoutButton, {
      global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
    expect(loggedOut).toBe(1);
    expect(router.currentRoute.value.name).toBe("login");
    registry.dispose();
  });

  it("shows the login page when the session was already gone", async () => {
    const session = { me: user };
    const { registry, router } = setup(session, {
      "POST /auth/logout": () => ApiTesting.unauthorized(),
    });
    await router.push("/links");
    session.me = () => ApiTesting.unauthorized();
    const wrapper = mount(LogoutButton, {
      global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("login");
    registry.dispose();
  });
});
