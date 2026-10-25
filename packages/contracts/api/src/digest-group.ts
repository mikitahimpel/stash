import * as Digest from "@stash/contracts-domain/digest";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

export class DigestGroup extends HttpApiGroup.make("digest")
  .add(
    // `NotFound` until the first digest is built.
    HttpApiEndpoint.get("latest", "/digest/latest", {
      success: Digest.Digest,
      error: ErrorStatuses.NotFound,
    }),
  )
  .middleware(Security.Authorization) {}
