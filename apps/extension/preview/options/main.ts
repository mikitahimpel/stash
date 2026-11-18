import { createApp } from "vue";
import OptionsPage from "../../entrypoints/options/options-page.vue";
import * as PreviewStates from "./preview-states.ts";

// `/#unpaired`, `/#pairing`, `/#paired` or `/#error`: the real options page over a made-up state.
const wanted = location.hash.slice(1);
const state = PreviewStates.states.find((it) => it === wanted) ?? "unpaired";

createApp(OptionsPage, { actions: PreviewStates.actions(state) }).mount("#app");
