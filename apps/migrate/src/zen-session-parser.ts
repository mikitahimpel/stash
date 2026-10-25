import { Data, DateTime, Effect, Schema } from "effect";
import * as MozLz4 from "./mozlz4.ts";

/**
 * Reads the parts of a Zen (Firefox) session store that an import needs: every window's tabs with
 * the URL and title of the entry the tab is showing, and the Zen workspace ("space") each tab
 * belongs to. Unknown fields are ignored, so newer Zen versions still parse.
 */

const RawEntry = Schema.Struct({
  url: Schema.String,
  title: Schema.optional(Schema.String),
});

const RawTab = Schema.Struct({
  entries: Schema.Array(RawEntry),
  // 1-based index into `entries`; the entry the tab is currently showing.
  index: Schema.optional(Schema.Number),
  // Epoch milliseconds.
  lastAccessed: Schema.optional(Schema.Number),
  pinned: Schema.optional(Schema.Boolean),
  zenWorkspace: Schema.optional(Schema.String),
});

const RawSpace = Schema.Struct({
  uuid: Schema.String,
  name: Schema.optional(Schema.String),
});

const RawWindow = Schema.Struct({
  tabs: Schema.Array(RawTab),
  spaces: Schema.optional(Schema.Array(RawSpace)),
});

const RawSession = Schema.Struct({
  windows: Schema.Array(RawWindow),
  spaces: Schema.optional(Schema.Array(RawSpace)),
});

const decodeRawSession = Schema.decodeUnknownEffect(Schema.fromJsonString(RawSession));

export class ZenSessionError extends Data.TaggedError("ZenSessionError")<{
  readonly message: string;
}> {}

export interface ZenWorkspace {
  readonly id: string;
  readonly name: string | null;
}

export interface ZenTab {
  readonly url: string;
  readonly title: string | null;
  readonly lastAccessedAt: DateTime.Utc | null;
  readonly pinned: boolean;
  readonly workspaceId: string | null;
  readonly workspaceName: string | null;
}

export interface ZenWindow {
  readonly tabs: ReadonlyArray<ZenTab>;
}

export interface ZenSession {
  readonly windows: ReadonlyArray<ZenWindow>;
  readonly workspaces: ReadonlyArray<ZenWorkspace>;
}

const nonEmpty = (value: string | undefined): string | null =>
  value === undefined || value.trim() === "" ? null : value;

const toWorkspaces = (session: typeof RawSession.Type): ReadonlyArray<ZenWorkspace> => {
  const byId = new Map<string, ZenWorkspace>();
  const spaces = [...(session.spaces ?? []), ...session.windows.flatMap((w) => w.spaces ?? [])];
  for (const space of spaces) {
    const name = nonEmpty(space.name);
    const known = byId.get(space.uuid);
    if (known === undefined || (known.name === null && name !== null)) {
      byId.set(space.uuid, { id: space.uuid, name });
    }
  }
  return [...byId.values()];
};

const toTab = (
  tab: typeof RawTab.Type,
  workspaces: ReadonlyMap<string, ZenWorkspace>,
): ZenTab | null => {
  if (tab.entries.length === 0) return null;
  const index = Math.min(
    Math.max(Math.trunc(tab.index ?? tab.entries.length), 1),
    tab.entries.length,
  );
  const entry = tab.entries[index - 1]!;
  const workspaceId = nonEmpty(tab.zenWorkspace);
  return {
    url: entry.url,
    title: nonEmpty(entry.title),
    lastAccessedAt:
      tab.lastAccessed !== undefined && Number.isFinite(tab.lastAccessed) && tab.lastAccessed > 0
        ? DateTime.makeUnsafe(tab.lastAccessed)
        : null,
    pinned: tab.pinned ?? false,
    workspaceId,
    workspaceName: workspaceId === null ? null : (workspaces.get(workspaceId)?.name ?? null),
  };
};

/** Parses the JSON text of a session store. Tabs without history entries are skipped. */
export const parse = (json: string): Effect.Effect<ZenSession, ZenSessionError> =>
  decodeRawSession(json).pipe(
    Effect.mapError((error) => new ZenSessionError({ message: error.message })),
    Effect.map((raw) => {
      const workspaces = toWorkspaces(raw);
      const byId = new Map(workspaces.map((w) => [w.id, w]));
      return {
        workspaces,
        windows: raw.windows.map((window) => ({
          tabs: window.tabs.flatMap((tab) => toTab(tab, byId) ?? []),
        })),
      };
    }),
  );

/** Parses a `recovery.jsonlz4` (or `.baklz4`) file's bytes. */
export const parseMozLz4 = (
  bytes: Uint8Array,
): Effect.Effect<ZenSession, ZenSessionError | MozLz4.MozLz4Error> =>
  MozLz4.decode(bytes).pipe(
    Effect.flatMap((json) => parse(new TextDecoder("utf-8", { fatal: false }).decode(json))),
  );
