import * as AtomVue from "@effect/atom-vue";
import { createApp } from "vue";
import { createWebHistory } from "vue-router";
import AppLayout from "./app-layout.vue";
import * as AppRegistry from "./app-registry.ts";
import * as AppRouter from "./app-router.ts";
import "./styles.css";

createApp(AppLayout)
  .provide(AtomVue.registryKey, AppRegistry.make())
  .use(AppRouter.make(createWebHistory(import.meta.env.BASE_URL)))
  .mount("#app");
