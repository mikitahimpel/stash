// Infrastructure for Stash, declared with Alchemy v2 (beta). See docs/alchemy.md.
//
// Nothing personal lives here: physical names are derived from the stack, the stage
// (`--stage` or ALCHEMY_STAGE) and the logical ids below, and the Cloudflare account comes
// from CLOUDFLARE_ACCOUNT_ID or the Alchemy profile, used only by `alchemy deploy`.
// `alchemy dev` emulates every resource here locally and needs no credentials.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as State from "alchemy/State";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

// Migrations are applied in order on every reconcile (`alchemy dev` and deploy). Bookkeeping lives
// in Alchemy's `__alchemy_migrations` table. Paths resolve from the repo root.
export const Database = Cloudflare.D1.Database("Database", {
  migrations: "./apps/api/migrations",
});

export const EnrichmentQueue = Cloudflare.Queues.Queue("EnrichmentQueue");

// OAuth clients, grants and tokens of the MCP server (`@cloudflare/workers-oauth-provider`).
export const OAuthState = Cloudflare.KV.Namespace("OAuthState");

export default Alchemy.Stack(
  "stash",
  {
    providers: Cloudflare.providers(),
    // State stays on disk in the gitignored `.alchemy/` folder.
    state: State.localState(),
  },
  Effect.gen(function* () {
    const port = yield* Config.Port("STASH_API_PORT").pipe(Config.withDefault(8787));
    const host = yield* Config.String("STASH_API_HOST").pipe(Config.withDefault("0.0.0.0"));
    // The `/_smoke/*` routes exist only under `alchemy dev` (see apps/api/src/smoke-routes.ts).
    const dev = yield* Alchemy.ALCHEMY_DEV;
    // Personal values come from env. Local dev gets placeholders; a deploy requires real ones.
    // `dev_only` can never be a GitHub login (GitHub allows no underscores).
    const devDefault = <A>(config: Config.Config<A>, value: A) =>
      dev ? config.pipe(Config.withDefault(value)) : config;
    const allowedGithubLogin = yield* devDefault(
      Config.String("STASH_ALLOWED_GITHUB_LOGIN"),
      "dev_only",
    );
    const webOrigin = yield* devDefault(Config.String("STASH_WEB_ORIGIN"), "http://localhost:5173");
    const mcpPort = yield* Config.Port("STASH_MCP_PORT").pipe(Config.withDefault(8790));
    const mcpOrigin = yield* devDefault(
      Config.String("STASH_MCP_ORIGIN"),
      `http://localhost:${mcpPort}`,
    );
    // Secrets: Redacted, so Alchemy never prints them. Local dev gets placeholders that GitHub and
    // the api reject, so the sign-in only completes with real values.
    const devSecret = (name: string) =>
      devDefault(Config.Redacted(name), Redacted.make("dev_only"));
    const githubClientId = yield* devDefault(Config.String("GITHUB_OAUTH_CLIENT_ID"), "dev_only");
    const githubClientSecret = yield* devSecret("GITHUB_OAUTH_CLIENT_SECRET");
    const mcpApiToken = yield* devSecret("STASH_MCP_API_TOKEN");

    const db = yield* Database;
    const queue = yield* EnrichmentQueue;
    const oauthState = yield* OAuthState;

    const api = yield* Cloudflare.Worker("Api", {
      main: "./apps/api/src/worker.ts",
      env: {
        DB: db,
        ENRICHMENT_QUEUE: queue,
        ALLOWED_GITHUB_LOGIN: allowedGithubLogin,
        WEB_ORIGIN: webOrigin,
        SMOKE_ROUTES: dev ? "on" : "off",
      },
      dev: { host, port, strictPort: true },
    });

    yield* Cloudflare.Queues.Consumer("EnrichmentConsumer", {
      queueId: queue.queueId,
      scriptName: api.workerName,
      settings: { batchSize: 10, maxWaitTimeMs: 1000 },
    });

    // Bindings must match apps/mcp/src/worker-env.ts.
    const mcp = yield* Cloudflare.Worker("Mcp", {
      main: "./apps/mcp/src/worker.ts",
      env: {
        API: api,
        API_TOKEN: mcpApiToken,
        OAUTH_KV: oauthState,
        MCP_ORIGIN: mcpOrigin,
        GITHUB_OAUTH_CLIENT_ID: githubClientId,
        GITHUB_OAUTH_CLIENT_SECRET: githubClientSecret,
        ALLOWED_GITHUB_LOGIN: allowedGithubLogin,
      },
      dev: { host, port: mcpPort, strictPort: true },
    });

    return { url: api.url, mcpUrl: mcp.url };
  }),
);
