import * as TokensHandlers from "@stash/backend-auth/tokens-handlers";
import * as Api from "@stash/contracts-api/api";
import type * as Security from "@stash/contracts-api/security";
import * as Effect from "effect/Effect";
import type * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Layer from "effect/Layer";
import * as Record from "effect/Record";
import { NotImplemented } from "./not-implemented.ts";

type GroupName = keyof typeof Api.StashApi.groups & string;

/** Answers every endpoint of the group with 501 `NotImplemented`. */
const notImplemented = <const Name extends GroupName>(
  name: Name,
): Layer.Layer<HttpApiGroup.Service<"stash", Name>, never, Security.Authorization> =>
  HttpApiBuilder.group(
    Api.StashApi,
    name,
    (handlers) =>
      handlers.handleAll(
        Record.map(
          Api.StashApi.groups[name].endpoints as Record.ReadonlyRecord<string, unknown>,
          (_, endpoint) => () =>
            Effect.die(new NotImplemented({ endpoint: `${name}.${endpoint}` })),
        ) as never,
      ) as never,
  ) as never;

// One handler layer per `StashApi` group. A feature replaces its `notImplemented(...)` line with
// its package's handler layer.
export const layer = Layer.mergeAll(
  notImplemented("links"),
  notImplemented("search"),
  notImplemented("tabs"),
  notImplemented("devices"),
  TokensHandlers.layer,
  notImplemented("auth"),
  notImplemented("digest"),
);
