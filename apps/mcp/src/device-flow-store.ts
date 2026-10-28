// Pending GitHub device flows in `OAUTH_KV`, one per authorization in progress. The key is the
// SHA-256 of the provider's upstream `state`, which only the signing-in browser holds. The entry
// expires with the flow. It holds GitHub's device code, never a GitHub access token.

/** The provider keeps an approved request for its upstream step for 10 minutes. */
export const maxSeconds = 600;

/** KV rejects an `expirationTtl` below 60 seconds. */
const minTtlSeconds = 60;

export interface Flow {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  /** Seconds between polls, raised by 5 on every `slow_down`. */
  readonly interval: number;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
  /** Epoch milliseconds before which GitHub is not polled again. */
  readonly nextPollAt: number;
}

const key = async (state: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"));
  return `device-flow:${hex.join("")}`;
};

export const make = (kv: KVNamespace) => ({
  get: async (state: string): Promise<Flow | null> =>
    state === "" ? null : kv.get<Flow>(await key(state), "json"),
  put: async (state: string, flow: Flow, now: number) =>
    kv.put(await key(state), JSON.stringify(flow), {
      expirationTtl: Math.max(minTtlSeconds, Math.ceil((flow.expiresAt - now) / 1000)),
    }),
  delete: async (state: string) => kv.delete(await key(state)),
});
