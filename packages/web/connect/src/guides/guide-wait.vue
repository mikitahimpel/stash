<script setup lang="ts">
import { injectRegistry, useAtomValue } from "@effect/atom-vue";
import { Check } from "@lucide/vue";
import StatusDot from "@stash/web-ui/status-dot";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, onBeforeUnmount, watch } from "vue";
import * as ConnectAtoms from "../connect-atoms.ts";
import * as ConnectStatus from "../connect-status.ts";

// The last line of a guide: polls the api until what the guide set up gets in touch, then says
// what arrived.
const props = defineProps<{
  awaited: ConnectStatus.Awaited;
  /** While waiting: `Waiting for your first save…`. */
  waiting: string;
  /** For a contact without a link: `the Mac agent checked in`. */
  contact?: string;
}>();

const registry = injectRegistry();
const snapshot = useAtomValue(() => ConnectAtoms.snapshot);
const arrival = computed(() =>
  AsyncResult.isSuccess(snapshot.value)
    ? ConnectStatus.arrival(props.awaited, snapshot.value.value)
    : undefined,
);

let timer: ReturnType<typeof setInterval> | undefined;
const stop = () => {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
};
watch(
  arrival,
  (arrived) => {
    if (arrived !== undefined) stop();
    else if (timer === undefined)
      timer = setInterval(() => ConnectAtoms.refresh(registry), ConnectAtoms.pollMillis);
  },
  { immediate: true },
);
onBeforeUnmount(stop);

const message = computed(() => {
  const arrived = arrival.value;
  if (arrived === undefined) return undefined;
  if (arrived._tag === "Link") return `Connected ✓ — “${arrived.title}” arrived`;
  if (arrived._tag === "Claude") return "Connected ✓ — Claude used Stash";
  return `Connected ✓ — ${props.contact ?? "it got in touch"}`;
});
</script>

<template>
  <p
    v-if="message === undefined"
    role="status"
    data-test="waiting"
    class="flex items-center gap-2 text-body text-muted-foreground"
  >
    <StatusDot tone="signal" />
    {{ waiting }}
  </p>
  <p v-else role="status" data-test="arrived" class="flex items-center gap-2 text-body">
    <Check :size="16" aria-hidden="true" />
    {{ message }}
  </p>
</template>
