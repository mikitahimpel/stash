import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Security from "./security.ts";

/** What the Connect page's guides need from the deploy, beyond the web app's own origin. */
export const ConnectInfo = Schema.Struct({
  /** The MCP endpoint to add to Claude as a custom connector, or `null` if the deploy has none. */
  mcpUrl: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isNonEmpty()))),
});
export type ConnectInfo = typeof ConnectInfo.Type;

export class ConnectGroup extends HttpApiGroup.make("connect")
  .add(
    HttpApiEndpoint.get("info", "/connect/info", {
      success: ConnectInfo,
    }),
  )
  .middleware(Security.Authorization) {}
