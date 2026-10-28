import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

/** Identifies one device flow. The GitHub `device_code` stays on the server, keyed by it. */
export const DeviceFlowId = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand("DeviceFlowId"),
);
export type DeviceFlowId = typeof DeviceFlowId.Type;

const Seconds = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));

/** What the user needs to authorize the flow on GitHub, and how often the client may poll. */
export const DeviceFlowStarted = Schema.Struct({
  flowId: DeviceFlowId,
  /** The code the user types at `verificationUri`. */
  userCode: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  verificationUri: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  /** Seconds until the flow expires. */
  expiresIn: Seconds,
  /** Minimum seconds between two polls. */
  interval: Seconds,
});
export type DeviceFlowStarted = typeof DeviceFlowStarted.Type;

export const PollDeviceFlow = Schema.Struct({
  flowId: DeviceFlowId,
});
export type PollDeviceFlow = typeof PollDeviceFlow.Type;

/** The user has not authorized yet. Poll again after `interval` seconds. */
export const DeviceFlowPending = Schema.Struct({ status: Schema.Literal("pending") });
/** Polled too fast. Add 5 seconds to the interval, then poll again. */
export const DeviceFlowSlowDown = Schema.Struct({ status: Schema.Literal("slow_down") });
/** Signed in. The response also sets the session cookie. */
export const DeviceFlowComplete = Schema.Struct({
  status: Schema.Literal("complete"),
  me: Security.UserPrincipal,
});

/** The state of a device flow, discriminated by `status`. */
export const DeviceFlowStatus = Schema.Union([
  DeviceFlowPending,
  DeviceFlowSlowDown,
  DeviceFlowComplete,
]);
export type DeviceFlowStatus = typeof DeviceFlowStatus.Type;

/**
 * Login by the GitHub OAuth Device Flow, which needs no client secret. `deviceStart` and
 * `devicePoll` run before a session exists, so only `me` and `logout` are guarded; `deviceStart` is
 * rate limited per client IP (`RateLimited`, 429). The client shows `userCode` and
 * `verificationUri`, then polls `devicePoll` every `interval` seconds until it answers `complete` (with the session cookie) or fails with `DeviceFlowExpired` (410),
 * `DeviceFlowDenied` (403) or `LoginNotAllowed` (403, the GitHub login is not allowlisted).
 */
export class AuthGroup extends HttpApiGroup.make("auth").add(
  HttpApiEndpoint.get("me", "/auth/me", {
    success: Security.Principal,
  }).middleware(Security.Authorization),
  HttpApiEndpoint.post("deviceStart", "/auth/device/start", {
    success: DeviceFlowStarted,
    error: ErrorStatuses.RateLimited,
  }),
  HttpApiEndpoint.post("devicePoll", "/auth/device/poll", {
    payload: PollDeviceFlow,
    success: DeviceFlowStatus,
    error: [
      ErrorStatuses.DeviceFlowExpired,
      ErrorStatuses.DeviceFlowDenied,
      ErrorStatuses.LoginNotAllowed,
    ],
  }),
  HttpApiEndpoint.post("logout", "/auth/logout", {
    success: HttpApiSchema.NoContent,
  }).middleware(Security.Authorization),
) {}
