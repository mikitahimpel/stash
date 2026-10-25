import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * What to hand to the system share sheet.
 */
export interface ShareData {
  readonly title?: string;
  readonly text?: string;
  readonly url?: string;
}

/**
 * Why sharing failed:
 * - `Unsupported`: the browser has no Web Share API, or can't share this data.
 * - `Aborted`: the user dismissed the share sheet.
 * - `NotAllowed`: the call was blocked, for example without a user gesture.
 * - `Failed`: any other error.
 */
export type ShareErrorReason = "Unsupported" | "Aborted" | "NotAllowed" | "Failed";

export class ShareError extends Data.TaggedError("ShareError")<{
  readonly reason: ShareErrorReason;
  readonly cause?: unknown;
}> {}

/**
 * The system share sheet (Web Share API).
 */
export class Share extends Context.Service<
  Share,
  {
    /** `true` when `share` can be called with this data. */
    readonly canShare: (data: ShareData) => Effect.Effect<boolean>;
    /** Opens the share sheet. Succeeds once the user picked a target. */
    readonly share: (data: ShareData) => Effect.Effect<void, ShareError>;
  }
>()("@stash/web-platform/Share") {}

const reasonOf = (cause: unknown): ShareErrorReason => {
  if (cause instanceof DOMException) {
    if (cause.name === "AbortError") return "Aborted";
    if (cause.name === "NotAllowedError") return "NotAllowed";
    if (cause.name === "DataError") return "Unsupported";
  }
  return "Failed";
};

const canShareSync = (data: ShareData): boolean =>
  typeof navigator.share === "function" &&
  (typeof navigator.canShare !== "function" || navigator.canShare(data));

/**
 * The live service, backed by `navigator.share` and `navigator.canShare`.
 */
export const layer: Layer.Layer<Share> = Layer.succeed(Share)({
  canShare: (data) => Effect.sync(() => canShareSync(data)),
  share: (data) =>
    Effect.suspend(() =>
      canShareSync(data)
        ? Effect.tryPromise({
            try: () => navigator.share(data),
            catch: (cause) => new ShareError({ reason: reasonOf(cause), cause }),
          })
        : Effect.fail(new ShareError({ reason: "Unsupported" })),
    ),
});
