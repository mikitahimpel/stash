import * as Live from "@stash/ext-platform/live";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { createApp } from "vue";
import * as PopupActions from "./popup-actions.ts";
import PopupPage from "./popup-page.vue";

createApp(PopupPage, { actions: PopupActions.make(ManagedRuntime.make(Live.layer)) }).mount("#app");
