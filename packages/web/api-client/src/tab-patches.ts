import type * as TabsGroup from "@stash/contracts-api/tabs";
import type * as Device from "@stash/contracts-domain/device";
import type * as LinkEvent from "@stash/contracts-domain/link-event";
import * as DateTime from "effect/DateTime";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

// What the live stream said about open tabs: the newest tab set of each device that reported one
// (`tabs.updated`), laid over the cached `GET /tabs` answer when it is read. A device's set
// replaces its snapshot in place, so Open now shows a tab opened on another device without asking
// again. Of two sets of one device the one taken later wins, so a fresher answer of the api is
// never undone by an older event.

/** The newest `tabs.updated` of each device, by device id. */
export type Patches = ReadonlyMap<Device.DeviceId, LinkEvent.TabsUpdated>;

/** The patches of a registry. */
export const state: Atom.Writable<Patches> = Atom.make<Patches>(new Map()).pipe(Atom.keepAlive);

/**
 * Counts the gaps of the stream: each time it opened again after it had been open, or the window
 * got the focus back, a reader of tabs asks again (the stream replays nothing).
 */
export const gaps: Atom.Writable<number> = Atom.make(0).pipe(Atom.keepAlive);

const takenAt = (snapshot: { readonly takenAt: DateTime.Utc } | null | undefined): number =>
  snapshot === null || snapshot === undefined
    ? -Infinity
    : DateTime.toEpochMillis(snapshot.takenAt);

/** Keeps the event unless a later set of its device is known already. */
export const record = (registry: AtomRegistry.AtomRegistry, event: LinkEvent.TabsUpdated): void => {
  const known = registry.get(state).get(event.device.id);
  if (known !== undefined && takenAt(known.snapshot) >= takenAt(event.snapshot)) return;
  registry.update(state, (patches) => new Map(patches).set(event.device.id, event));
};

/** Notes a gap of the stream: the tabs may have changed unseen. */
export const markGap = (registry: AtomRegistry.AtomRegistry): void =>
  registry.update(gaps, (count) => count + 1);

/**
 * `all` with every device's newer set laid over it. A device the answer does not list yet (one
 * connected after it) is added at the end, as the api lists devices oldest first. Returns `all`
 * itself when nothing changes, and the devices without a patch as they are.
 */
export const apply = (all: TabsGroup.AllTabs, patches: Patches): TabsGroup.AllTabs => {
  if (patches.size === 0) return all;
  let changed = false;
  const listed = new Set<string>();
  const devices = all.devices.map((entry) => {
    listed.add(entry.device.id);
    const patch = patches.get(entry.device.id);
    if (patch === undefined || takenAt(patch.snapshot) <= takenAt(entry.snapshot)) return entry;
    changed = true;
    return { device: patch.device, snapshot: patch.snapshot, saved: patch.saved };
  });
  for (const patch of patches.values()) {
    if (listed.has(patch.device.id)) continue;
    changed = true;
    devices.push({ device: patch.device, snapshot: patch.snapshot, saved: patch.saved });
  }
  return changed ? { ...all, devices } : all;
};
