import * as Blobs from "@stash/backend-platform/blobs";
import type * as Link from "@stash/contracts-domain/link";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

/** The R2 key of a link's text. */
export const key = (id: Link.LinkId): string => `links/${id}.txt`;

/** Writes a link's text to R2, replacing any earlier version. */
export const storeText = (
  id: Link.LinkId,
  text: string,
): Effect.Effect<void, Blobs.BlobsError, Blobs.Blobs> =>
  Blobs.Blobs.use((blobs) =>
    blobs.put(key(id), text, { contentType: "text/plain; charset=utf-8" }),
  );

/** Reads a link's text back, `None` when it was never stored. */
export const readText = (
  id: Link.LinkId,
): Effect.Effect<Option.Option<string>, Blobs.BlobsError, Blobs.Blobs> =>
  Blobs.Blobs.use((blobs) => blobs.getText(key(id)));
