import { describe, expect, it } from "@effect/vitest";
import * as SearchGroup from "@stash/contracts-api/search";
import * as LinksGroup from "@stash/contracts-api/links";
import * as Link from "@stash/contracts-domain/link";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schema from "effect/Schema";
import * as LinkPatches from "../src/link-patches.ts";
import * as Fixtures from "./fixtures.ts";

const decode = (id: string, fields: Record<string, unknown> = {}) =>
  Schema.decodeUnknownSync(Link.Link)({ ...Fixtures.link(id), ...fields });

const t0 = "2026-01-01T00:00:00.000Z";
const t1 = "2026-01-01T00:00:05.000Z";
const t2 = "2026-01-01T00:00:09.000Z";

/** `a` as enrichment left it at `at`. */
const enriched = (id: string, at: string) =>
  decode(id, { summary: `Summary of ${id}.`, enrichedAt: at, updatedAt: at, tags: ["economics"] });

const updated = (link: Link.Link): LinkPatches.Patches =>
  new Map([[link.id, { _tag: "Updated", link, at: 1000 }]]);
const deleted = (id: string): LinkPatches.Patches =>
  new Map([[Link.LinkId.make(id), { _tag: "Deleted" }]]);

describe("LinkPatches.apply", () => {
  it("replaces the link in a list, a search result and a details answer, and nothing else", () => {
    const a = decode("a", { updatedAt: t0 });
    const b = decode("b", { updatedAt: t0 });
    const patches = updated(enriched("a", t1));

    const pull = { done: false, items: [a, b] };
    const patchedPull = LinkPatches.apply(pull, patches);
    expect(patchedPull.items[0]).toMatchObject({ id: "a", summary: "Summary of a." });
    expect(patchedPull.items[0]!.enrichedAt).not.toBeNull();
    // The untouched link is the same object: its row has nothing to render again.
    expect(patchedPull.items[1]).toBe(b);
    expect(patchedPull.done).toBe(false);

    const results: SearchGroup.SearchResults = { hits: [{ link: a, score: 2 }] };
    expect(LinkPatches.apply(results, patches).hits[0]).toMatchObject({
      link: { summary: "Summary of a." },
      score: 2,
    });

    expect(LinkPatches.apply(a, patches).summary).toBe("Summary of a.");
    const history = { links: [b, a], now: a.createdAt };
    const patchedHistory = LinkPatches.apply(history, patches);
    expect(patchedHistory.links[1]!.tags).toEqual(["economics"]);
    // A value that is not plain data (a `DateTime`) is left as it is.
    expect(patchedHistory.now).toBe(history.now);
  });

  it("returns the very same answer when no patch touches it", () => {
    const answer = { done: true, items: [decode("b"), decode("c")] };
    expect(LinkPatches.apply(answer, updated(enriched("a", t1)))).toBe(answer);
    expect(LinkPatches.apply(answer, deleted("a"))).toBe(answer);
    expect(LinkPatches.apply(answer, new Map())).toBe(answer);
  });

  it("keeps the later copy: an answer newer than the patch wins", () => {
    const patches = updated(enriched("a", t1));
    const older = decode("a", { updatedAt: t0 });
    const same = enriched("a", t1);
    const newer = decode("a", { status: "done", updatedAt: t2 });
    expect(LinkPatches.apply(older, patches).summary).toBe("Summary of a.");
    expect(LinkPatches.apply(same, patches)).toBe(same);
    expect(LinkPatches.apply(newer, patches)).toBe(newer);
    // A copy without a time (an api that does not send it yet) takes the patch.
    expect(LinkPatches.apply(decode("a"), patches).summary).toBe("Summary of a.");
  });

  it("keeps what a struct adds to the link", () => {
    const saved: LinksGroup.SavedLink = { ...decode("a", { updatedAt: t0 }), created: true };
    expect(LinkPatches.apply(saved, updated(enriched("a", t1)))).toMatchObject({
      created: true,
      summary: "Summary of a.",
    });
  });

  it("takes a deleted link out of lists and search results, and leaves a details answer", () => {
    const a = decode("a");
    const b = decode("b");
    expect(LinkPatches.apply({ done: true, items: [a, b] }, deleted("a")).items).toEqual([b]);
    expect(
      LinkPatches.apply(
        {
          hits: [
            { link: a, score: 2 },
            { link: b, score: 1 },
          ],
        },
        deleted("a"),
      ).hits,
    ).toEqual([{ link: b, score: 1 }]);
    expect(LinkPatches.apply(a, deleted("a"))).toBe(a);
  });
});

describe("LinkPatches.insert", () => {
  const at = (id: string, createdAt: string, fields: Record<string, unknown> = {}) =>
    decode(id, { createdAt, ...fields });
  const day = (n: number) => `2026-01-0${n}T00:00:00.000Z`;
  const items = [at("c", day(5)), at("b", day(3)), at("a", day(1))];
  const patchesOf = (...links: ReadonlyArray<Link.Link>): LinkPatches.Patches =>
    new Map(links.map((link) => [link.id, { _tag: "Updated", link, at: 1000 }]));
  const options = { done: false, accepts: () => true, answeredAt: 1000 };
  const ids = (links: ReadonlyArray<Link.Link>) => links.map((link) => link.id);

  it("puts a new link at its place by the time it was saved", () => {
    const patches = patchesOf(at("new", day(6)), at("mid", day(4)), at("mid2", day(2)));
    expect(ids(LinkPatches.insert(items, { ...options, patches }))).toEqual([
      "new",
      "c",
      "mid",
      "b",
      "mid2",
      "a",
    ]);
  });

  it("returns the very same list when there is nothing to put in", () => {
    expect(LinkPatches.insert(items, { ...options, patches: new Map() })).toBe(items);
    // A link the list holds is only replaced (by `apply`), never added twice.
    expect(LinkPatches.insert(items, { ...options, patches: patchesOf(items[1]!) })).toBe(items);
    expect(LinkPatches.insert(items, { ...options, patches: deleted("gone") })).toBe(items);
  });

  it("leaves out a link the list's filters do not take", () => {
    const patches = patchesOf(at("seen", day(6), { status: "seen" }), at("new", day(7)));
    const accepts = (link: Link.Link) => link.status === "new";
    expect(ids(LinkPatches.insert(items, { ...options, accepts, patches }))).toEqual([
      "new",
      "c",
      "b",
      "a",
    ]);
  });

  it("leaves a link older than the last loaded one to its page, unless the list is done", () => {
    const patches = patchesOf(at("old", "2025-12-01T00:00:00.000Z"));
    expect(LinkPatches.insert(items, { ...options, patches })).toBe(items);
    expect(ids(LinkPatches.insert(items, { ...options, done: true, patches }))).toEqual([
      "c",
      "b",
      "a",
      "old",
    ]);
    expect(ids(LinkPatches.insert([], { ...options, done: true, patches }))).toEqual(["old"]);
  });

  it("leaves out a link the api did not list in a later answer", () => {
    const patches = patchesOf(at("new", day(6)));
    // The answer came long after the patch and has no such link: it was deleted since.
    const later = 1000 + LinkPatches.insertGraceMillis + 1;
    expect(LinkPatches.insert(items, { ...options, answeredAt: later, patches })).toBe(items);
    // An answer that was on its way while the link was saved may just have missed it.
    expect(
      ids(LinkPatches.insert(items, { ...options, answeredAt: later - 2, patches })),
    ).toContain("new");
  });
});

describe("LinkPatches.pendingIds", () => {
  it("finds the links enrichment has not reached, at any depth", () => {
    const answer = {
      items: [decode("a"), enriched("b", t1)],
      hits: [{ link: decode("c"), score: 1 }],
      one: decode("a"),
    };
    expect([...LinkPatches.pendingIds(answer)].sort()).toEqual(["a", "c"]);
    expect(LinkPatches.pendingIds(null).size).toBe(0);
  });
});

describe("LinkPatches.record", () => {
  const at = Schema.decodeUnknownSync(Schema.DateTimeUtcFromString)(t2);

  it("keeps the latest copy of a link, and a delete for good", () => {
    const registry = AtomRegistry.make();
    const patch = () => registry.get(LinkPatches.state).get(Link.LinkId.make("a"));
    LinkPatches.record(registry, { type: "link.updated", at, link: enriched("a", t1) });
    // An older copy that arrives late (a slow catch-up) does not undo the newer one.
    LinkPatches.update(registry, decode("a", { updatedAt: t0 }));
    expect(patch()).toMatchObject({ _tag: "Updated", link: { summary: "Summary of a." } });
    LinkPatches.record(registry, { type: "stream.ready", at });
    expect(registry.get(LinkPatches.state).size).toBe(1);

    LinkPatches.record(registry, { type: "link.deleted", at, id: Link.LinkId.make("a") });
    LinkPatches.update(registry, enriched("a", t2));
    expect(patch()).toEqual({ _tag: "Deleted" });
    registry.dispose();
  });

  it("forgets the oldest patches past the cap", () => {
    const registry = AtomRegistry.make();
    for (let i = 0; i <= LinkPatches.maxPatches; i++) LinkPatches.update(registry, decode(`l${i}`));
    const patches = registry.get(LinkPatches.state);
    expect(patches.size).toBe(LinkPatches.maxPatches);
    expect(patches.has(Link.LinkId.make("l0"))).toBe(false);
    expect(patches.has(Link.LinkId.make(`l${LinkPatches.maxPatches}`))).toBe(true);
    registry.dispose();
  });
});
