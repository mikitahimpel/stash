import { Archive, Check, Eye } from "@lucide/vue";
import type * as Link from "@stash/contracts-domain/link";
import type { Component } from "vue";

/** One way to move a link on: its button's label and icon, and its key (S, D, E). */
export interface StatusAction {
  readonly status: Exclude<Link.LinkStatus, "new">;
  readonly label: string;
  readonly key: string;
  readonly icon: Component;
}

export const all: ReadonlyArray<StatusAction> = [
  { status: "seen", label: "Mark seen", key: "S", icon: Eye },
  { status: "done", label: "Mark done", key: "D", icon: Check },
  { status: "archived", label: "Archive", key: "E", icon: Archive },
];

/** Whether moving `link` to `status` changes anything: only a new link can be marked seen. */
export const applies = (link: Link.Link, status: Link.LinkStatus): boolean =>
  status === "seen" ? link.status === "new" : link.status !== status;

/** The actions `link` offers in its current status. */
export const available = (link: Link.Link): ReadonlyArray<StatusAction> =>
  all.filter((action) => applies(link, action.status));
