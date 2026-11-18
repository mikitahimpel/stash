import { afterEach, describe, expect, it, vi } from "vitest";
import * as BuildOrigin from "../build-origin.ts";
import config from "../wxt.config.ts";

// The Stash address is baked in at build time from `STASH_WEB_ORIGIN`, which the web app's deploy
// sets (`alchemy.run.ts`). Every address here is invented.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("build-time origin", () => {
  it.each([
    ["https://stash.example.com", "https://stash.example.com"],
    ["https://stash.example.com/", "https://stash.example.com"],
    ["  http://localhost:8791/connect  ", "http://localhost:8791"],
    ["stash.example.com", ""],
    ["ftp://stash.example.com", ""],
    ["https://", ""],
    ["", ""],
    [undefined, ""],
  ])("normalizes %j", (value, origin) => {
    expect(BuildOrigin.normalize(value)).toBe(origin);
  });

  it("defines the origin for the bundle, as a JSON string", () => {
    expect(BuildOrigin.define({ STASH_WEB_ORIGIN: "https://stash.example.com/" })).toEqual({
      "import.meta.env.STASH_WEB_ORIGIN": '"https://stash.example.com"',
    });
    // A build without the variable has no built-in origin.
    expect(BuildOrigin.define({})).toEqual({ "import.meta.env.STASH_WEB_ORIGIN": '""' });
  });

  it("the WXT build takes the define from the environment", async () => {
    vi.stubEnv("STASH_WEB_ORIGIN", "https://stash.example.com");
    const vite = typeof config.vite === "function" ? await config.vite(wxtEnv) : undefined;
    expect(vite?.define).toEqual({
      "import.meta.env.STASH_WEB_ORIGIN": '"https://stash.example.com"',
    });
  });

  it("reads the origin the bundle was built with", () => {
    expect(BuildOrigin.builtIn()).toBe("");
    vi.stubEnv("STASH_WEB_ORIGIN", "https://stash.example.com/");
    expect(BuildOrigin.builtIn()).toBe("https://stash.example.com");
  });
});

const wxtEnv = {
  mode: "production",
  command: "build",
  browser: "firefox",
  manifestVersion: 2,
} as const;
