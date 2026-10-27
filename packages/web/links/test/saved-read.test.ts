import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Link from "@stash/contracts-domain/link";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schema from "effect/Schema";
import * as SavedRead from "../src/list/saved-read.ts";
import * as Fixtures from "./fixtures.ts";

const decode = Schema.decodeUnknownSync(Link.Link);
const at = (id: string, createdAt: string, status = "new"): Link.Link =>
  decode(Fixtures.link(id, { createdAt, status }));

const utc = DateTime.zoneMakeNamedUnsafe("UTC");
const now = DateTime.makeUnsafe("2026-10-27T10:00:00.000Z");

describe("history", () => {
  it("counts saved, read and unread links per day and in total", () => {
    const history = SavedRead.history(
      [
        at("a", "2026-10-27T09:00:00.000Z", "new"),
        at("b", "2026-10-27T08:00:00.000Z", "seen"),
        at("c", "2026-10-26T08:00:00.000Z", "done"),
        at("d", "2026-10-26T07:00:00.000Z", "archived"),
        at("e", "2026-09-28T00:00:00.000Z", "new"),
        // Before the 30 days.
        at("f", "2026-09-27T23:59:59.000Z", "seen"),
      ],
      now,
      utc,
    );
    expect(history.days).toHaveLength(30);
    expect(history.days[0]).toEqual({ key: "2026-09-28", saved: 1, read: 0, unread: 1 });
    expect(history.days.at(-2)).toEqual({ key: "2026-10-26", saved: 2, read: 1, unread: 0 });
    expect(history.days.at(-1)).toEqual({ key: "2026-10-27", saved: 2, read: 1, unread: 1 });
    expect({ saved: history.saved, read: history.read, unread: history.unread }).toEqual({
      saved: 5,
      read: 2,
      unread: 2,
    });
  });

  it("has 30 empty days without links", () => {
    const history = SavedRead.history([], now, utc);
    expect(history.days.map((day) => day.saved)).toEqual(Array.from({ length: 30 }, () => 0));
    expect(history.saved).toBe(0);
  });
});

describe("recent", () => {
  let registry: AtomRegistry.AtomRegistry | undefined;
  afterEach(() => {
    registry?.dispose();
    registry = undefined;
  });

  it.effect("pages through GET /links until a page reaches past 31 days ago", () =>
    Effect.gen(function* () {
      const today = new Date();
      const daysAgo = (days: number) =>
        new Date(today.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
      const queries: Array<Record<string, string>> = [];
      const pages: Record<string, ReturnType<typeof Fixtures.page>> = {
        first: Fixtures.page([Fixtures.link("a", { createdAt: daysAgo(1) })], "page-2"),
        "page-2": Fixtures.page(
          [
            Fixtures.link("b", { createdAt: daysAgo(10) }),
            Fixtures.link("c", { createdAt: daysAgo(40) }),
          ],
          "page-3",
        ),
        "page-3": Fixtures.page([Fixtures.link("d", { createdAt: daysAgo(50) })]),
      };
      registry = ApiTesting.makeRegistry({
        "GET /links": (request) => {
          const query = Fixtures.query(request);
          queries.push(query);
          return pages[query.cursor ?? "first"] ?? Fixtures.page([]);
        },
      });
      const unmount = registry.mount(SavedRead.recent);
      const loaded = yield* AtomRegistry.getResult(registry, SavedRead.recent);

      expect(loaded.links.map((link) => link.id)).toEqual(["a", "b"]);
      expect(queries).toEqual([
        { sort: "recent", limit: "100" },
        { sort: "recent", limit: "100", cursor: "page-2" },
      ]);
      unmount();
    }),
  );
});
