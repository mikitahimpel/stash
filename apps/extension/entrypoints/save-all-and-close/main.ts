import * as SaveAllAndClose from "@stash/ext-capture/save-all-and-close";
import * as Live from "@stash/ext-platform/live";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import { createApp } from "vue";
import SaveAllAndClosePage from "./save-all-and-close-page.vue";

const runtime = ManagedRuntime.make(Live.layer);

createApp(SaveAllAndClosePage, {
  load: () =>
    runtime.runPromise(
      SaveAllAndClose.pending.pipe(
        Effect.map(Option.getOrNull),
        Effect.orElseSucceed(() => null),
      ),
    ),
  confirm: () =>
    runtime.runPromise(
      SaveAllAndClose.confirm.pipe(
        Effect.map(Option.getOrNull),
        Effect.orElseSucceed(() => null),
      ),
    ),
  close: () => runtime.runPromise(SaveAllAndClose.dismiss.pipe(Effect.ignore)),
}).mount("#app");
