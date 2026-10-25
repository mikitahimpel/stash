import type { EnrichmentMessage, WorkerEnv } from "./worker-env.ts";

// Spike consumer: logs each message and records its id so the smoke test can see delivery.
// Real enrichment arrives with @stash/backend-enrichment.
export const handleQueue = async (
  batch: MessageBatch<EnrichmentMessage>,
  env: WorkerEnv,
): Promise<void> => {
  for (const message of batch.messages) {
    console.log(`queue ${batch.queue}: received ${message.body.id}`);
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS smoke_queue_receipts (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL)",
    ).run();
    await env.DB.prepare(
      "INSERT OR REPLACE INTO smoke_queue_receipts (id, received_at) VALUES (?, ?)",
    )
      .bind(message.body.id, Date.now())
      .run();
    message.ack();
  }
};
