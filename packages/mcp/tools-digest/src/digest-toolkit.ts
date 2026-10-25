import { Effect } from "effect";
import { Toolkit } from "effect/ai";
import * as GetLatestDigest from "./get-latest-digest-tool.ts";

/** Tools for the digest. */
export const toolkit = Toolkit.make(GetLatestDigest.tool);

/** The tool handlers. They call the api through `StashApiClient` only. */
export const layer = toolkit.toLayer(
  Effect.gen(function* () {
    return toolkit.of({ get_latest_digest: yield* GetLatestDigest.handler });
  }),
);
