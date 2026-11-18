import { createApp } from "vue";
import PopupPage from "../../entrypoints/popup/popup-page.vue";
import * as PreviewStates from "./preview-states.ts";

// `/#paired`, `/#saved` or `/#not-paired`: the real popup page over a made-up state.
const wanted = location.hash.slice(1);
const state = PreviewStates.states.find((it) => it === wanted) ?? "paired";

createApp(PopupPage, { actions: PreviewStates.actions(state) }).mount("#app");
