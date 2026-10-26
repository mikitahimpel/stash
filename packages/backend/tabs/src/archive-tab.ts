import * as SaveLink from "@stash/backend-links/save-link";
import type * as TabsApi from "@stash/contracts-api/tabs";
import type * as Security from "@stash/contracts-api/security";
import * as Effect from "effect/Effect";
import * as EnqueueCommand from "./commands/enqueue-command.ts";
import * as FindDevice from "./devices/find-device.ts";

// The link is saved through `@stash/backend-links`, which owns the `links` table: an archived tab
// is deduplicated by canonical URL, rate limited and enriched like any other saved link. Copying
// that SQL here would mean a second writer to `links` that could drift from the first.

/** Saves an open tab as a link and queues a `close-tab` command for its device. */
export const archiveTab = Effect.fn("archiveTab")(function* (
  principal: Security.Principal,
  input: TabsApi.ArchiveTab,
) {
  yield* FindDevice.findDevice(input.deviceId);
  const link = yield* SaveLink.saveLink(
    principal,
    input.title === undefined ? { url: input.url } : { url: input.url, title: input.title },
  );
  const command = yield* EnqueueCommand.enqueueCommand(input.deviceId, {
    kind: "close-tab",
    url: input.url,
  });
  return { link, command } satisfies TabsApi.ArchivedTab;
});
