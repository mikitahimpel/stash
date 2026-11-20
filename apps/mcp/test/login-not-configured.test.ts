import { describe, expect, it } from "vitest";
import { handleLoginNotConfigured } from "../src/login-not-configured.ts";

const get = (path: string) => new Request(`https://mcp.example.com${path}`);

describe("handleLoginNotConfigured", () => {
  it("answers 503 on the sign-in pages without a client id", () => {
    for (const path of ["/authorize", "/authorize/device", "/authorize/poll"]) {
      expect(handleLoginNotConfigured(get(path), {})?.status).toBe(503);
    }
  });

  it("keeps the OAuth metadata, registration, token and MCP endpoints", () => {
    for (const path of ["/.well-known/oauth-authorization-server", "/register", "/token", "/mcp"]) {
      expect(handleLoginNotConfigured(get(path), {})).toBeUndefined();
    }
    expect(handleLoginNotConfigured(get("/authorizex"), {})).toBeUndefined();
  });

  it("passes everything through once the client id is set", () => {
    const env = { GITHUB_CLIENT_ID: "synthetic-client-id" };
    expect(handleLoginNotConfigured(get("/authorize"), env)).toBeUndefined();
  });
});

describe("handleLoginNotConfigured on the web app's own host", () => {
  const env = { WEB_ORIGIN: "https://mcp.example.com" };

  it("keeps the web sign-in, which needs no GitHub app, and closes the device flow", () => {
    expect(handleLoginNotConfigured(get("/authorize"), env)).toBeUndefined();
    expect(handleLoginNotConfigured(get("/authorize/session?state=x"), env)).toBeUndefined();
    for (const path of ["/authorize/device", "/authorize/poll"]) {
      expect(handleLoginNotConfigured(get(path), env)?.status).toBe(503);
    }
  });
});
