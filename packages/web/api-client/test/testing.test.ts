import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as ApiAtoms from "../src/api-atoms.ts";
import * as Testing from "../src/testing.ts";
import * as Unauthenticated from "../src/unauthenticated.ts";
import * as Fixtures from "./fixtures.ts";

const linkById = (id: string) =>
  ApiAtoms.query(["links"], (client) => client.links.get({ params: { id: id as never } }));

describe("Testing.makeRegistry", () => {
  it.effect("matches routes by method and path, with :params", () =>
    Effect.gen(function* () {
      const reg = Testing.makeRegistry({
        "GET /links/:id": (_, { id }) => Testing.json(Fixtures.link(`seen-${id}`)),
      });
      const link = yield* AtomRegistry.getResult(reg, linkById("a1"));
      expect(link.id).toBe("seen-a1");
      reg.dispose();
    }),
  );

  it.effect("answers unmatched requests with a 404 the client reports as a defect", () =>
    Effect.gen(function* () {
      const reg = Testing.makeRegistry({ "POST /links/:id": () => Testing.json({}) });
      const exit = yield* Effect.exit(AtomRegistry.getResult(reg, linkById("a")));
      expect(Exit.hasDies(exit)).toBe(true);
      reg.dispose();
    }),
  );

  it.effect("keeps each registry's stub separate", () =>
    Effect.gen(function* () {
      const one = Testing.makeRegistry({
        "GET /links/:id": () => Testing.json(Fixtures.link("1")),
      });
      const two = Testing.makeRegistry({
        "GET /links/:id": () => Testing.json(Fixtures.link("2")),
      });
      const [a, b] = yield* Effect.all(
        [AtomRegistry.getResult(one, linkById("x")), AtomRegistry.getResult(two, linkById("x"))],
        { concurrency: 2 },
      );
      expect([a.id, b.id]).toEqual(["1", "2"]);
      one.dispose();
      two.dispose();
    }),
  );
});

describe("Unauthenticated.onUnauthenticated", () => {
  it("stops calling the listener once stopped", () => {
    const reg = Testing.makeRegistry({});
    let events = 0;
    const stop = Unauthenticated.onUnauthenticated(reg, () => events++);
    Unauthenticated.emit(reg);
    stop();
    Unauthenticated.emit(reg);
    expect(events).toBe(1);
    reg.dispose();
  });
});
