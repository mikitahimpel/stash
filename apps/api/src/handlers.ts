import * as AuthHandlers from "@stash/backend-auth/auth-handlers";
import * as DigestHandlers from "@stash/backend-digest/digest-handlers";
import * as LinksHandlers from "@stash/backend-links/links-handlers";
import * as TokensHandlers from "@stash/backend-auth/tokens-handlers";
import * as SearchHandlers from "@stash/backend-search/search-handlers";
import * as DevicesHandlers from "@stash/backend-tabs/devices-handlers";
import * as TabsHandlers from "@stash/backend-tabs/tabs-handlers";
import * as Layer from "effect/Layer";

// One handler layer per `StashApi` group.
export const layer = Layer.mergeAll(
  LinksHandlers.layer,
  SearchHandlers.layer,
  TabsHandlers.layer,
  DevicesHandlers.layer,
  TokensHandlers.layer,
  AuthHandlers.layer,
  DigestHandlers.layer,
);
