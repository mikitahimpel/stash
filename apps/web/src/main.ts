import * as AtomVue from "@effect/atom-vue";
import * as LiveLinks from "@stash/web-api-client/live-links";
import * as Auth from "@stash/web-auth/routes";
import { createApp } from "vue";
import { createWebHistory } from "vue-router";
import AppLayout from "./app-layout.vue";
import * as AppPrefetch from "./app-prefetch.ts";
import * as AppRegistry from "./app-registry.ts";
import * as AppRouter from "./app-router.ts";
import * as ThemeAtoms from "@stash/web-settings/theme-atoms";
import "./styles.css";

const registry = AppRegistry.make();
// Applies the stored theme as the app starts and keeps following the OS scheme.
registry.mount(ThemeAtoms.state);

const router = AppRouter.make(createWebHistory(import.meta.env.BASE_URL), registry);
// Live link updates: one connection to the api's event stream while someone is signed in, so a
// link turns from `summarizing…` into its summary by itself. A public page (the login) holds none:
// the stream would answer 401.
let leaveLive: (() => void) | undefined;
router.afterEach((to) => {
  if (Auth.isPublic(to)) {
    leaveLive?.();
    leaveLive = undefined;
  } else leaveLive ??= registry.mount(LiveLinks.connection);
});

const app = createApp(AppLayout).provide(AtomVue.registryKey, registry).use(router);
// Mounts once the first navigation, with its auth check, is done, so a signed-out visitor sees the
// login page and never the app shell.
void router.isReady().then(() => {
  app.mount("#app");
  // The other header tabs, once the first page is up and the browser has time: their code, and
  // for a signed-in user their first data. The login page loads the code alone.
  AppPrefetch.preloadWhenIdle(Auth.isPublic(router.currentRoute.value) ? undefined : registry);
});
