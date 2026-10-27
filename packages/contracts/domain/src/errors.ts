import { Schema } from "effect";

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  resource: Schema.String,
  id: Schema.String,
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  message: Schema.String,
}) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  message: Schema.String,
}) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  retryAfterSeconds: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
}) {}

export class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  message: Schema.String,
}) {}

export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", {
  message: Schema.String,
}) {}

/** The device flow is unknown or GitHub expired its code. The client starts a new flow. */
export class DeviceFlowExpired extends Schema.TaggedError<DeviceFlowExpired>()(
  "DeviceFlowExpired",
  { message: Schema.String },
) {}

/** The user declined the authorization on GitHub. */
export class DeviceFlowDenied extends Schema.TaggedError<DeviceFlowDenied>()("DeviceFlowDenied", {
  message: Schema.String,
}) {}

/** GitHub authenticated a login that is not on the allowlist. */
export class LoginNotAllowed extends Schema.TaggedError<LoginNotAllowed>()("LoginNotAllowed", {
  message: Schema.String,
}) {}
