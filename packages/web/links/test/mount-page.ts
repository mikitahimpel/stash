import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { routes } from "../src/routes.ts";

/** Mounts the links routes at `path` against the stub api `routes`. */
export const mountAt = async (path: string, api: ApiTesting.Routes) => {
  const router = createRouter({ history: createMemoryHistory(), routes: [...routes] });
  await router.push(path);
  const registry = ApiTesting.makeRegistry(api);
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    attachTo: "body",
    global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
  });
  await settle();
  return { wrapper, router, registry };
};

/** Waits for pending requests, route changes and re-renders. */
export const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
