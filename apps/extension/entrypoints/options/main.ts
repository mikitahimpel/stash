import * as Live from "@stash/ext-platform/live";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { createApp } from "vue";
import OptionsPage from "./options-page.vue";
import * as PairExtension from "./pair-extension.ts";
import * as SaveConfig from "./save-config.ts";

const runtime = ManagedRuntime.make(Live.layer);

createApp(OptionsPage, {
  load: () => runtime.runPromise(SaveConfig.load),
  save: (input: SaveConfig.Input) => runtime.runPromise(SaveConfig.submit(input)),
  connect: (webOrigin: string, onCheck: (check: string) => void) =>
    runtime.runPromise(PairExtension.connect(webOrigin, onCheck)),
}).mount("#app");
