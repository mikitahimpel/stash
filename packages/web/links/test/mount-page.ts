import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as PlatformTesting from "@stash/web-platform/testing";
import { flushPromises, mount } from "@vue/test-utils";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import * as InboxShortcuts from "../src/list/inbox-shortcuts.ts";
import { routes } from "../src/routes.ts";

/**
 * Mounts the links routes at `path` against the stub api `routes`, on an in-memory keyboard.
 * `press` simulates a key press on it.
 */
export const mountAt = async (path: string, api: ApiTesting.Routes) => {
  // Settings stands in for the route the onboarding card links to.
  const settings = { path: "/settings", name: "settings", component: { render: () => null } };
  const router = createRouter({ history: createMemoryHistory(), routes: [...routes, settings] });
  await router.push(path);
  // Built once, so the test presses keys on the same instance the page listens on.
  const keyboard = Layer.build(PlatformTesting.layerKeyboard).pipe(Effect.scoped, Effect.runSync);
  const registry = ApiTesting.makeRegistry(api, {
    initialValues: [[InboxShortcuts.keyboard, Layer.succeedContext(keyboard)]],
  });
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    attachTo: "body",
    global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
  });
  await settle();
  const press = async (key: string) => {
    const taken = Effect.runSync(
      Context.get(keyboard, PlatformTesting.TestKeyboard).press({ key }),
    );
    await settle();
    return taken;
  };
  return { wrapper, router, registry, press };
};

/** Waits for pending requests, route changes and re-renders. */
export const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
