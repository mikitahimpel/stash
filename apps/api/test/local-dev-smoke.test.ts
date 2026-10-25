// Boots the root `alchemy.run.ts` under `alchemy dev` (no Cloudflare credentials) and drives the
// local Worker over HTTP: health, a D1 write + read, and one queue message through the consumer.
import { type ChildProcess, spawn } from "node:child_process";
import * as Http from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const port = Number(process.env["STASH_SMOKE_PORT"] ?? 8788);
const baseUrl = `http://localhost:${port}`;

interface SmokeResponse {
  readonly status: number;
  readonly body: string;
}

// node:http keeps the test off the `fetch` global, which oxlint reserves for platform packages.
const call = (method: "GET" | "POST", path: string): Promise<SmokeResponse> =>
  new Promise((resolve, reject) => {
    const req = Http.request(`${baseUrl}${path}`, { method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });

let dev: ChildProcess | undefined;
let output = "";

const waitFor = async <A>(
  what: string,
  attempt: () => Promise<A | undefined>,
  timeoutMs: number,
): Promise<A> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await attempt().catch(() => undefined);
    if (result !== undefined) return result;
    if (dev?.exitCode != null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${what}; alchemy dev output:\n${output}`);
};

const stopDev = async (): Promise<void> => {
  const child = dev;
  if (child?.pid === undefined || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  // SIGINT lets alchemy stop workerd and its sidecar. Fall back to killing the process group.
  process.kill(-child.pid, "SIGINT");
  const timer = setTimeout(() => process.kill(-child.pid!, "SIGKILL"), 10_000);
  await exited;
  clearTimeout(timer);
};

beforeAll(async () => {
  const env: NodeJS.ProcessEnv = { ...process.env, STASH_API_PORT: String(port) };
  // Prove that no Cloudflare credentials are needed.
  for (const key of Object.keys(env)) if (key.startsWith("CLOUDFLARE_")) delete env[key];

  dev = spawn("node_modules/.bin/alchemy", ["dev", "--stage", "smoke"], {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  dev.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  dev.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

  await waitFor(
    "GET /health",
    async () => ((await call("GET", "/health")).status === 200 ? true : undefined),
    90_000,
  );
});

afterAll(stopDev);

describe("alchemy dev (local, no credentials)", () => {
  it("serves GET /health", async () => {
    const response = await call("GET", "/health");
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok" });
  });

  it("writes and reads a D1 row", async () => {
    const response = await call("POST", "/_smoke/d1");
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as { written: string; read: string | null };
    expect(body.read).toBe(body.written);
  });

  it("delivers a queue message to the consumer", async () => {
    const response = await call("POST", "/_smoke/queue");
    expect(response.status).toBe(202);
    const { sent } = JSON.parse(response.body) as { sent: string };

    const received = await waitFor(
      "queue delivery",
      async () => {
        const receipt = await call("GET", `/_smoke/queue/${sent}`);
        return receipt.status === 200
          ? (JSON.parse(receipt.body) as { received: string })
          : undefined;
      },
      30_000,
    );
    expect(received.received).toBe(sent);
    expect(output).toContain(`received ${sent}`);
  });
});
