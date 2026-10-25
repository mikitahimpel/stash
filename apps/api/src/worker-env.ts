// Bindings declared for the `Api` Worker in the root `alchemy.run.ts`. Keep the two in sync.
export interface WorkerEnv {
  readonly DB: D1Database;
  readonly ENRICHMENT_QUEUE: Queue<EnrichmentMessage>;
  /** `"on"` only under `alchemy dev`; enables the `/_smoke/*` routes. */
  readonly SMOKE_ROUTES: string;
}

/** Placeholder body until the enrichment contract exists. */
export interface EnrichmentMessage {
  readonly id: string;
}
