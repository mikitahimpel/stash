import * as Device from "@stash/contracts-domain/device";
import * as Schema from "effect/Schema";
import type { RouteRecordRaw } from "vue-router";

const isKind = Schema.is(Device.DeviceKind);

export const routes: ReadonlyArray<RouteRecordRaw> = [
  {
    path: "/settings",
    name: "settings",
    component: () => import("./settings-page.vue"),
    // `?add=device` opens the Add device dialog, for the pages that send people here to do that, and
    // `&kind=` picks the device's kind in it.
    props: (route) => ({
      startAdding: route.query.add === "device",
      ...(isKind(route.query.kind) ? { startKind: route.query.kind } : {}),
    }),
  },
];
