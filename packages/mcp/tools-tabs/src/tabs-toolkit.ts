import { Effect } from "effect";
import { Toolkit } from "effect/ai";
import * as ArchiveTab from "./archive-tab-tool.ts";
import * as CloseTab from "./close-tab-tool.ts";
import * as ListOpenTabs from "./list-open-tabs-tool.ts";

/** Tools for the tabs open across devices. */
export const toolkit = Toolkit.make(ListOpenTabs.tool, ArchiveTab.tool, CloseTab.tool);

/** The tool handlers. They call the api through `StashApiClient` only. */
export const layer = toolkit.toLayer(
  Effect.gen(function* () {
    return toolkit.of({
      list_open_tabs: yield* ListOpenTabs.handler,
      archive_tab: yield* ArchiveTab.handler,
      close_tab_on_device: yield* CloseTab.handler,
    });
  }),
);
