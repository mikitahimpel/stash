import { HttpApi, OpenApi } from "effect/http-api";
import * as Auth from "./auth-group.ts";
import * as Devices from "./devices-group.ts";
import * as Digest from "./digest-group.ts";
import * as Links from "./links-group.ts";
import * as Search from "./search-group.ts";
import * as Tabs from "./tabs-group.ts";
import * as Tokens from "./tokens-group.ts";

/** The whole Stash HTTP API. `apps/api` serves it and every client derives from it. */
export class StashApi extends HttpApi.make("stash")
  .add(Links.LinksGroup)
  .add(Search.SearchGroup)
  .add(Tabs.TabsGroup)
  .add(Devices.DevicesGroup)
  .add(Tokens.TokensGroup)
  .add(Auth.AuthGroup)
  .add(Digest.DigestGroup)
  .annotateMerge(OpenApi.annotations({ title: "Stash API" })) {}
