import * as Errors from "@stash/contracts-domain/errors";
import { HttpApiSchema } from "effect/http-api";

// The domain errors carry no HTTP knowledge. These are the same schemas with the status each one
// maps to on the wire. Private to this package: groups attach them to endpoints.

export const NotFound = Errors.NotFound.pipe(HttpApiSchema.status(404));
export const ValidationError = Errors.ValidationError.pipe(HttpApiSchema.status(400));
export const Unauthorized = Errors.Unauthorized.pipe(HttpApiSchema.status(401));
export const Forbidden = Errors.Forbidden.pipe(HttpApiSchema.status(403));
export const RateLimited = Errors.RateLimited.pipe(HttpApiSchema.status(429));
export const Conflict = Errors.Conflict.pipe(HttpApiSchema.status(409));
