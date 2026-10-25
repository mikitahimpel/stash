import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

/**
 * Raised as a defect by endpoints whose feature has not landed yet. The contracts declare no error
 * for it, so it answers through `Respondable`: 501 with a JSON body naming the endpoint.
 */
export class NotImplemented extends Data.TaggedError("NotImplemented")<{
  readonly endpoint: string;
}> {
  [HttpServerRespondable.symbol]() {
    return Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        { _tag: "NotImplemented", endpoint: this.endpoint },
        { status: 501 },
      ),
    );
  }
}
