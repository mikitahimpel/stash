import * as Digest from "@stash/contracts-domain/digest";
import * as ApiClient from "@stash/mcp-platform/api-client";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";

export const tool = Tool.make("get_latest_digest", {
  description:
    "Get the latest digest: link totals, top tags and types, and highlights for the last period " +
    "(weekly by default).",
  success: Schema.Struct({
    digest: Schema.NullOr(Digest.Digest).annotate({
      description: "null until the first digest is built.",
    }),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const handler = Effect.gen(function* () {
  const client = yield* ApiClient.StashApiClient;
  return Effect.fn("get_latest_digest")(function* () {
    const digest = yield* client.digest.latest().pipe(
      Effect.catchTag("NotFound", () => Effect.succeed(null)),
      Effect.orDie,
    );
    return { digest };
  });
});
