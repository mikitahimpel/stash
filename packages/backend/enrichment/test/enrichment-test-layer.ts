import * as LinksRepo from "@stash/backend-links/links-repo";
import * as SaveRateLimiter from "@stash/backend-links/save-rate-limiter";
import * as Testing from "@stash/backend-platform/testing";
import * as AiQuota from "@stash/backend-users/ai-quota";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as ContentHttp from "../src/content-http.ts";
import * as EnrichPolicy from "../src/enrich-policy.ts";
import * as EnrichmentRepo from "../src/enrichment-repo.ts";
import * as FakeHttp from "./fake-http.ts";
import * as FakeLanguageModel from "./fake-language-model.ts";

/**
 * The links feature (to save links), the enrichment repo, and fakes for everything external: D1,
 * the queue (with its consumer side), the live stream (with what was published), R2, Vectorize,
 * Workers AI, HTTP and the language model. The database has the testing users, and everything runs
 * as the owner (no AI quota) unless a test says otherwise (`Testing.as(Testing.member)`).
 */
export const layer = (
  routes: Readonly<Record<string, FakeHttp.Route>>,
  ...replies: ReadonlyArray<FakeLanguageModel.Reply>
) =>
  Layer.mergeAll(
    EnrichmentRepo.layer,
    LinksRepo.layer,
    SaveRateLimiter.layer(SaveRateLimiter.defaultOptions),
    AiQuota.layer,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Testing.layerDatabase,
        Testing.layerCurrentUser(),
        Testing.layerEnrichmentQueue,
        Testing.layerLinkEvents,
        Testing.layerKv,
        Testing.layerBlobs,
        Testing.layerVectors,
        Testing.layerAi(),
        FakeHttp.layer(routes),
        FakeLanguageModel.layer(...replies),
      ),
    ),
  );

/** Retries without delays, so tests of the retry paths run instantly. */
export const noDelays = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    Effect.provideService(EnrichPolicy.EnrichPolicy, {
      ...EnrichPolicy.defaultPolicy,
      retrySchedule: Schedule.forever,
    }),
    Effect.provideService(ContentHttp.FetchPolicy, {
      ...ContentHttp.defaultPolicy,
      retrySchedule: Schedule.forever,
    }),
  );
