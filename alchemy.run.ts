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
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

// Migrations are applied in order on every reconcile (`alchemy dev` and deploy). Bookkeeping lives
// in Alchemy's `__alchemy_migrations` table. Paths resolve from the repo root.
export const Database = Cloudflare.D1.Database("Database", {
  migrations: "./apps/api/migrations",
});

export const EnrichmentQueue = Cloudflare.Queues.Queue("EnrichmentQueue");

// OAuth clients, grants and tokens of the MCP server (`@cloudflare/workers-oauth-provider`).
export const OAuthState = Cloudflare.KV.Namespace("OAuthState");
// Save rate limits of the `Api` Worker.
export const Kv = Cloudflare.KV.Namespace("Kv");
// Extracted page text and transcripts, written by the enrichment consumer.
export const Blobs = Cloudflare.R2.Bucket("Blobs");
// Link embeddings: `@cf/baai/bge-m3` vectors (1024-d), compared by cosine similarity. Vectorize has
// no local provider, so only a deploy creates it (see docs/alchemy.md).
export const Vectors = Cloudflare.Vectorize.Index("Vectors", {
  dimensions: 1024,
  metric: "cosine",
});

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
    const webPort = yield* Config.Port("STASH_WEB_PORT").pipe(Config.withDefault(8791));
    const webHost = yield* Config.String("STASH_WEB_HOST").pipe(Config.withDefault("0.0.0.0"));
    // The `/_smoke/*` routes exist only under `alchemy dev` (see apps/api/src/smoke-routes.ts).
    const dev = yield* Alchemy.ALCHEMY_DEV;
    const stage = yield* Alchemy.Stage;
    // Personal values come from env. Local dev gets placeholders; a deploy requires real ones.
    // `dev_only` can never be a GitHub login (GitHub allows no underscores).
    const devDefault = <A>(config: Config.Config<A>, value: A) =>
      dev ? config.pipe(Config.withDefault(value)) : config;
    // Optional on deploy: `None` leaves the binding out or falls back to a derived value.
    const devDefaultOption = <A>(config: Config.Config<A>, value: A) =>
      dev ? config.pipe(Config.withDefault(value), Config.map(Option.some)) : Config.option(config);
    const allowedGithubLogin = yield* devDefault(
      Config.String("STASH_ALLOWED_GITHUB_LOGIN"),
      "dev_only",
    );
    // The GitHub OAuth app's client id. The Device Flow login needs no client secret, and the id
    // is public, so it is bound as a plain var. Local dev gets a placeholder that GitHub rejects.
    // Without it a deploy still succeeds, and the login routes answer 503 (see docs/deploy.md).
    const githubClientId = yield* devDefaultOption(Config.String("GITHUB_CLIENT_ID"), "dev_only");
    const mcpPort = yield* Config.Port("STASH_MCP_PORT").pipe(Config.withDefault(8790));
    // The token `Mcp` calls the api with. Redacted, so it is bound as `secret_text`. Without it a
    // deploy still succeeds, and the api answers the tools' calls with 401.
    const mcpApiToken = yield* devDefaultOption(
      Config.Redacted("STASH_MCP_API_TOKEN"),
      Redacted.make("dev_only"),
    );
    // The classifier's key, bound as `secret_text`. `alchemy dev` never reads it, so local dev stays
    // credential-free (the enrichment consumer then retries each message, see apps/api/src/worker.ts).
    const anthropicApiKey = dev
      ? Option.none<Redacted.Redacted<string>>()
      : yield* Config.option(Config.Redacted("ANTHROPIC_API_KEY"));

    // Deployed Workers get fixed names: `stash-<role>` on stage `prod`, `stash-<role>-<stage>`
    // otherwise. `alchemy dev` keeps the derived names.
    const workerName = (role: string) =>
      stage === "prod"
        ? `stash-${role}`
        : `stash-${role}-${stage.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
    const named = (role: string) => (dev ? {} : { name: workerName(role) });
    // The api and the SPA need each other's origin (CORS, `VITE_API_BASE_URL`), so the deployed
    // origins are derived from the fixed names and the account's workers.dev subdomain, unless set.
    const origins = dev
      ? {
          web: yield* Config.String("STASH_WEB_ORIGIN").pipe(
            Config.withDefault("http://localhost:5173"),
          ),
          mcp: yield* Config.String("STASH_MCP_ORIGIN").pipe(
            Config.withDefault(`http://localhost:${mcpPort}`),
          ),
          api: undefined,
        }
      : yield* Effect.gen(function* () {
          const subdomain = yield* workersSubdomain;
          const workersDev = (role: string) =>
            `https://${workerName(role)}.${subdomain}.workers.dev`;
          return {
            web: yield* Config.String("STASH_WEB_ORIGIN").pipe(
              Config.withDefault(workersDev("web")),
            ),
            mcp: yield* Config.String("STASH_MCP_ORIGIN").pipe(
              Config.withDefault(workersDev("mcp")),
            ),
            api: workersDev("api"),
          };
        });
    const optional = <K extends string, A>(key: K, value: Option.Option<A>) =>
      Option.match(value, {
        onNone: () => ({}),
        onSome: (a) => ({ [key]: a }),
      }) as { readonly [P in K]?: A };

    const db = yield* Database;
    const queue = yield* EnrichmentQueue;
    const oauthState = yield* OAuthState;
    const kv = yield* Kv;
    const blobs = yield* Blobs;
    // Vectorize and Workers AI have no local provider, so only a deploy binds them.
    const vectors = dev ? undefined : yield* Vectors;

    const api = yield* Cloudflare.Worker("Api", {
      main: "./apps/api/src/worker.ts",
      ...named("api"),
      env: {
        DB: db,
        ENRICHMENT_QUEUE: queue,
        KV: kv,
        BLOBS: blobs,
        ...(vectors === undefined ? {} : { VECTORS: vectors, AI: Cloudflare.Workers.AI() }),
        ALLOWED_GITHUB_LOGIN: allowedGithubLogin,
        WEB_ORIGIN: origins.web,
        ...optional("GITHUB_CLIENT_ID", githubClientId),
        ...optional("ANTHROPIC_API_KEY", anthropicApiKey),
        SMOKE_ROUTES: dev ? "on" : "off",
      },
      // Auto-archive of stale Zen tabs (daily) and the weekly digest (Mondays), in UTC. Must match
      // the expressions in apps/api/src/scheduled-handler.ts, which dispatches on them.
      crons: ["0 3 * * *", "0 6 * * 1"],
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
      ...named("mcp"),
      env: {
        API: api,
        ...optional("API_TOKEN", mcpApiToken),
        OAUTH_KV: oauthState,
        MCP_ORIGIN: origins.mcp,
        ...optional("GITHUB_CLIENT_ID", githubClientId),
        ALLOWED_GITHUB_LOGIN: allowedGithubLogin,
      },
      dev: { host, port: mcpPort, strictPort: true },
    });

    // The SPA, served as Workers Static Assets. `alchemy dev` builds `apps/web` and serves `dist/`
    // from a local Worker; unknown paths fall back to `index.html` so the client router takes over.
    // For hot reload use `pnpm dev:web` (Vite) instead. A deploy builds it against the deployed api
    // (`VITE_API_BASE_URL`); `alchemy dev` leaves it unset, as before.
    const web = yield* Cloudflare.Website.StaticSite("Web", {
      cwd: "./apps/web",
      command: "pnpm run build",
      outdir: "dist",
      ...named("web"),
      env: origins.api === undefined ? {} : { VITE_API_BASE_URL: origins.api },
      assets: { notFoundHandling: "single-page-application" },
      // Rebuild when the app or a web package it bundles changes (gitignored files stay excluded).
      memo: { include: ["**/*", "../../packages/web/*/src/**"], lockfile: true },
      dev: { host: webHost, port: webPort },
    });

    return { url: api.url, mcpUrl: mcp.url, webUrl: web.url };
  }),
);

/**
 * The account's workers.dev subdomain (`<subdomain>` in `https://<name>.<subdomain>.workers.dev`),
 * read once from the Cloudflare API with the deploy's own credentials, or taken from
 * `CLOUDFLARE_WORKERS_SUBDOMAIN` (which Alchemy also honours). Neither value is ever logged.
 */
const workersSubdomain = Effect.gen(function* () {
  const configured = yield* Config.option(Config.String("CLOUDFLARE_WORKERS_SUBDOMAIN"));
  if (Option.isSome(configured) && configured.value !== "") return configured.value;
  const accountId = yield* Config.String("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = yield* Config.Redacted("CLOUDFLARE_API_TOKEN");
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const response = yield* client.execute(
    HttpClientRequest.get(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    ).pipe(HttpClientRequest.bearerToken(Redacted.value(apiToken))),
  );
  const body = yield* HttpIncomingMessage.schemaBodyJson(SubdomainResponse)(response);
  return body.result.subdomain;
}).pipe(
  Effect.provide(FetchHttpClient.layer),
  // The cause may quote the request URL, which holds the account id.
  Effect.mapError(
    () =>
      new Error(
        "Could not read the account's workers.dev subdomain. Set CLOUDFLARE_WORKERS_SUBDOMAIN, " +
          "or CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (see docs/deploy.md).",
      ),
  ),
  Effect.orDie,
);

const SubdomainResponse = Schema.Struct({
  result: Schema.Struct({ subdomain: Schema.String }),
});
