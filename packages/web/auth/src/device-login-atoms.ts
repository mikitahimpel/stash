import * as Clipboard from "@effect/platform-browser/Clipboard";
import type * as AuthGroup from "@stash/contracts-api/auth";
import type * as ApiAtoms from "@stash/web-api-client/api-atoms";
import { StashApiClient } from "@stash/web-api-client/stash-api-client";
import * as WebPlatform from "@stash/web-platform/live";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpClientError from "effect/http/HttpClientError";
import type * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

/** GitHub's rule: after `slow_down`, wait this many seconds longer between polls. */
export const slowDownSeconds = 5;

/**
 * Where a GitHub Device Flow login stands:
 *
 * - `waiting`: the user should enter `userCode` at `verificationUri` before `expiresAt` (epoch
 *   milliseconds). The page polls every `interval` seconds meanwhile.
 * - `complete`: signed in, the session cookie is set.
 * - `expired`, `denied`, `notAllowed`: the flow is over. The user may start a new one.
 * - `notConfigured`: this deployment has no GitHub login yet (the api answers 503 `NotConfigured`),
 *   so there is nothing to start.
 */
export type DeviceLogin =
  | {
      readonly step: "waiting";
      readonly userCode: string;
      readonly verificationUri: string;
      readonly expiresAt: number;
      readonly interval: number;
    }
  | { readonly step: "complete" }
  | { readonly step: "expired" }
  | { readonly step: "denied" }
  | { readonly step: "notAllowed" }
  | { readonly step: "notConfigured" };

// A deploy without `GITHUB_CLIENT_ID` answers the device flow routes with 503 `NotConfigured`. The
// contract doesn't declare it (the Worker answers before the api runs), so it arrives as a status
// code error.
const isNotConfigured = (error: unknown): boolean =>
  HttpClientError.isHttpClientError(error) && error.response?.status === 503;

type Waiting = Extract<DeviceLogin, { step: "waiting" }>;
const end = (login: DeviceLogin) => [[login], Option.none<number>()] as const;

// One poll every `interval` seconds until the flow ends. `slow_down` makes every later wait 5
// seconds longer. Expired, denied and not-allowed answers end the flow; transport failures fail the
// stream, and the page offers to start over.
const poll = (client: ApiAtoms.Client, flowId: AuthGroup.DeviceFlowId, waiting: Waiting) =>
  Stream.paginate(waiting.interval, (interval) =>
    Effect.gen(function* () {
      yield* Effect.sleep(Duration.seconds(interval));
      if ((yield* Clock.currentTimeMillis) >= waiting.expiresAt) return end({ step: "expired" });
      const status = yield* client.auth.devicePoll({ payload: { flowId } });
      switch (status.status) {
        case "pending":
          return [[], Option.some(interval)] as const;
        case "slow_down": {
          const slower = interval + slowDownSeconds;
          return [[{ ...waiting, interval: slower }], Option.some(slower)] as const;
        }
        case "complete":
          return end({ step: "complete" });
      }
    }).pipe(
      Effect.catchTags({
        DeviceFlowExpired: () => Effect.succeed(end({ step: "expired" })),
        DeviceFlowDenied: () => Effect.succeed(end({ step: "denied" })),
        LoginNotAllowed: () => Effect.succeed(end({ step: "notAllowed" })),
      }),
    ),
  );

/**
 * Starts a GitHub Device Flow (`/auth/device/start`) and polls `/auth/device/poll` at the interval
 * the api gives until the flow ends. Its value is the latest `DeviceLogin`. Writing it again starts
 * a new flow, which is how the page restarts an expired one.
 */
export const deviceLogin = StashApiClient.runtime.fn<void>()(() =>
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* StashApiClient;
      const started = yield* client.auth
        .deviceStart()
        .pipe(Effect.catchIf(isNotConfigured, () => Effect.succeed(undefined)));
      if (started === undefined) {
        return Stream.succeed<DeviceLogin>({ step: "notConfigured" });
      }
      const now = yield* Clock.currentTimeMillis;
      const waiting: Waiting = {
        step: "waiting",
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        expiresAt: now + started.expiresIn * 1000,
        interval: started.interval,
      };
      return Stream.concat(
        Stream.succeed<DeviceLogin>(waiting),
        poll(client, started.flowId, waiting),
      );
    }),
  ),
);

/** `m:ss` left until `expiresAt`, never below `0:00`. */
export const remaining = (expiresAt: number, now: number): string => {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/**
 * The `Clipboard` that `copyCode` writes to. Defaults to the browser's, from `@stash/web-platform`.
 * Tests replace it per registry through `initialValues`.
 */
export const clipboard: Atom.Writable<Layer.Layer<Clipboard.Clipboard>> = Atom.make(
  WebPlatform.layerClipboard,
).pipe(Atom.keepAlive);

const clipboardRuntime = Atom.runtime((get) => get(clipboard));

/** Copies the user code, to paste it on github.com. */
export const copyCode = clipboardRuntime.fn((code: string) =>
  Effect.gen(function* () {
    const clipboard = yield* Clipboard.Clipboard;
    yield* clipboard.writeString(code);
  }),
);
