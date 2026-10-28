import { describe, expect, it } from "vitest";
import { handleLoginNotConfigured } from "../src/login-not-configured.ts";

const webOrigin = "https://web.example.com";
const post = (path: string) => new Request(`https://api.example.com${path}`, { method: "POST" });

describe("handleLoginNotConfigured", () => {
  it("answers 503 on the device flow routes without a client id, readable by the SPA", async () => {
    for (const path of ["/auth/device/start", "/auth/device/poll"]) {
      const response = handleLoginNotConfigured(post(path), { WEB_ORIGIN: webOrigin });
      expect(response?.status).toBe(503);
      expect(response?.headers.get("access-control-allow-origin")).toBe(webOrigin);
      expect(await response?.json()).toMatchObject({ _tag: "NotConfigured" });
    }
  });

  it("passes other routes through", () => {
    expect(handleLoginNotConfigured(post("/links"), { WEB_ORIGIN: webOrigin })).toBeUndefined();
    const preflight = new Request("https://api.example.com/auth/device/start", {
      method: "OPTIONS",
    });
    expect(handleLoginNotConfigured(preflight, { WEB_ORIGIN: webOrigin })).toBeUndefined();
  });

  it("passes everything through once the client id is set", () => {
    const env = { WEB_ORIGIN: webOrigin, GITHUB_CLIENT_ID: "synthetic-client-id" };
    expect(handleLoginNotConfigured(post("/auth/device/start"), env)).toBeUndefined();
  });
});
