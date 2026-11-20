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

describe("handleLoginNotConfigured for Google", () => {
  const get = (path: string) => new Request(`https://api.example.com${path}`);

  it("answers 503 on the Google routes without a client id and secret", () => {
    for (const request of [
      get("/auth/google/start"),
      get("/auth/google/callback?code=x&state=y"),
      post("/auth/google/link"),
    ]) {
      expect(
        handleLoginNotConfigured(request, { WEB_ORIGIN: webOrigin, GITHUB_CLIENT_ID: "x" })?.status,
      ).toBe(503);
      // A client id without its secret is not enough.
      expect(
        handleLoginNotConfigured(request, {
          WEB_ORIGIN: webOrigin,
          GITHUB_CLIENT_ID: "x",
          GOOGLE_CLIENT_ID: "synthetic-google-client-id",
        })?.status,
      ).toBe(503);
    }
  });

  it("passes the Google routes through once both are set, and never blocks passkeys", () => {
    const env = {
      WEB_ORIGIN: webOrigin,
      GITHUB_CLIENT_ID: "x",
      GOOGLE_CLIENT_ID: "synthetic-google-client-id",
      GOOGLE_CLIENT_SECRET: "synthetic-google-client-secret",
    };
    expect(handleLoginNotConfigured(get("/auth/google/start"), env)).toBeUndefined();
    expect(
      handleLoginNotConfigured(post("/auth/passkey/options"), { WEB_ORIGIN: webOrigin }),
    ).toBeUndefined();
  });
});
