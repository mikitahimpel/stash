import * as AtomVue from "@effect/atom-vue";
import { createApp } from "vue";
import { createWebHistory } from "vue-router";
import AppLayout from "./app-layout.vue";
import * as AppRegistry from "./app-registry.ts";
import * as AppRouter from "./app-router.ts";
import * as ThemeAtoms from "@stash/web-settings/theme-atoms";
import "./styles.css";

const registry = AppRegistry.make();
// Applies the stored theme as the app starts and keeps following the OS scheme.
registry.mount(ThemeAtoms.state);

const router = AppRouter.make(createWebHistory(import.meta.env.BASE_URL), registry);
const app = createApp(AppLayout).provide(AtomVue.registryKey, registry).use(router);
// Mounts once the first navigation, with its auth check, is done, so a signed-out visitor sees the
// login page and never the app shell.
void router.isReady().then(() => app.mount("#app"));
