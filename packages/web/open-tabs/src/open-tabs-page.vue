<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import EmptyState from "@stash/web-ui/empty-state";
import Skeleton from "@stash/web-ui/skeleton";
import Toaster from "@stash/web-ui/toaster";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed } from "vue";
import OpenTabRow from "./open-tab-row.vue";
import * as OpenTabsAtoms from "./open-tabs-atoms.ts";

const registry = AtomVue.injectRegistry();
const view = AtomVue.useAtomValue(() => OpenTabsAtoms.view);
const toasts = AtomVue.useAtomValue(() => OpenTabsAtoms.toasts);
const archive = AtomVue.useAtomSet(() => OpenTabsAtoms.archive);
const closeOnDevice = AtomVue.useAtomSet(() => OpenTabsAtoms.closeOnDevice);

const dismiss = (id: string) => OpenTabsAtoms.dismissToast(registry, id);

const groups = computed(() => (AsyncResult.isSuccess(view.value) ? view.value.value : undefined));
</script>

<template>
  <section class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold">Open now</h1>

    <div v-if="groups === undefined && AsyncResult.isFailure(view)" data-state="error">
      <EmptyState title="Couldn't load open tabs" description="Try again in a moment." />
    </div>
    <div v-else-if="groups === undefined" data-state="loading" class="flex flex-col gap-2">
      <Skeleton v-for="i in 3" :key="i" class="h-10 w-full" />
    </div>
    <EmptyState
      v-else-if="groups.length === 0"
      data-state="empty"
      title="No devices yet"
      description="Install the extension or the Mac agent to see the tabs open on your devices."
    />
    <template v-else>
      <section
        v-for="group in groups"
        :key="group.device.id"
        data-slot="device"
        class="flex flex-col gap-1"
      >
        <header class="flex items-baseline justify-between gap-3 border-b pb-2">
          <h2 class="font-medium">
            {{ group.device.name }}
            <span class="text-sm font-normal text-muted-foreground">
              · {{ group.tabs.length }} {{ group.tabs.length === 1 ? "tab" : "tabs" }}
            </span>
          </h2>
          <span class="text-xs text-muted-foreground">
            {{
              group.reportedAge === null
                ? "Never reported"
                : group.reportedAge.label === "just now"
                  ? "Reported just now"
                  : `Reported ${group.reportedAge.label} ago`
            }}
          </span>
        </header>
        <ul v-if="group.tabs.length > 0" class="divide-y">
          <OpenTabRow
            v-for="(tab, i) in group.tabs"
            :key="`${tab.url}#${i}`"
            :tab="tab"
            @archive="archive(tab)"
            @close="closeOnDevice(tab)"
          />
        </ul>
        <p v-else class="py-2 text-sm text-muted-foreground">No open tabs.</p>
      </section>
    </template>

    <Toaster :toasts="toasts" @dismiss="dismiss" />
  </section>
</template>
