import * as Live from "@stash/ext-platform/live";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { createApp } from "vue";
import * as BuildOrigin from "../../build-origin.ts";
import * as OptionsActions from "./options-actions.ts";
import OptionsPage from "./options-page.vue";

createApp(OptionsPage, {
  actions: OptionsActions.make(ManagedRuntime.make(Live.layer), BuildOrigin.builtIn()),
}).mount("#app");
