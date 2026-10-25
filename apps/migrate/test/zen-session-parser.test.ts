import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import { readFileSync } from "node:fs";
import * as ZenSessionParser from "../src/zen-session-parser.ts";
import * as Encode from "./mozlz4-encode.ts";

const fixture: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/zen-session.synthetic.json", import.meta.url), "utf-8"),
);

const plain = (session: ZenSessionParser.ZenSession) =>
  session.windows.map((window) =>
    window.tabs.map((tab) => ({
      ...tab,
      lastAccessedAt: tab.lastAccessedAt === null ? null : DateTime.formatIso(tab.lastAccessedAt),
    })),
  );

describe("parseMozLz4", () => {
  it.effect("extracts windows, tabs and workspaces from a jsonlz4 session", () =>
    Effect.gen(function* () {
      const session = yield* ZenSessionParser.parseMozLz4(Encode.encodeJson(fixture));

      expect(session.workspaces).toEqual([
        { id: "{space-work}", name: "Work" },
        { id: "{space-reading}", name: "Reading" },
        { id: "{space-unnamed}", name: null },
      ]);
      expect(plain(session)).toEqual([
        [
          {
            url: "https://example.com/docs/guide",
            title: "Example guide",
            lastAccessedAt: "2026-01-02T03:04:05.000Z",
            pinned: true,
            workspaceId: "{space-work}",
            workspaceName: "Work",
          },
          {
            url: "https://example.org/articles/economics-video",
            title: null,
            lastAccessedAt: "2026-01-03T03:04:05.000Z",
            pinned: false,
            workspaceId: "{space-reading}",
            workspaceName: "Reading",
          },
        ],
        [
          {
            url: "https://example.net/second",
            title: "Second",
            lastAccessedAt: null,
            pinned: false,
            workspaceId: "{space-unnamed}",
            workspaceName: null,
          },
          {
            url: "https://example.net/no-workspace",
            title: "No workspace",
            lastAccessedAt: null,
            pinned: false,
            workspaceId: null,
            workspaceName: null,
          },
        ],
      ]);
    }),
  );

  it.effect("fails on a file that is not mozlz4", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ZenSessionParser.parseMozLz4(new TextEncoder().encode(JSON.stringify(fixture))),
      );
      expect(error._tag).toBe("MozLz4Error");
    }),
  );
});

describe("parse", () => {
  it.effect("clamps an out-of-range entry index to the history", () =>
    Effect.gen(function* () {
      const session = yield* ZenSessionParser.parse(
        JSON.stringify({
          windows: [
            {
              tabs: [
                { entries: [{ url: "https://example.com/a" }], index: 9 },
                { entries: [{ url: "https://example.com/b" }], index: 0 },
              ],
            },
          ],
        }),
      );
      expect(session.windows[0]?.tabs.map((tab) => tab.url)).toEqual([
        "https://example.com/a",
        "https://example.com/b",
      ]);
      expect(session.workspaces).toEqual([]);
    }),
  );

  it.effect("fails on JSON that is not a session", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(ZenSessionParser.parse('{"tabs":[]}'));
      expect(error._tag).toBe("ZenSessionError");
    }),
  );

  it.effect("fails on invalid JSON", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(ZenSessionParser.parse("{not json"));
      expect(error._tag).toBe("ZenSessionError");
    }),
  );
});
