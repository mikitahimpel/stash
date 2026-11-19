import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import * as KeepPlace from "../src/list/keep-place.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("isInsert", () => {
  it("is true when links were put in above the last one", () => {
    expect(KeepPlace.isInsert(["a", "b"], ["new", "a", "b"])).toBe(true);
    expect(KeepPlace.isInsert(["a", "b"], ["a", "new", "b"])).toBe(true);
    expect(KeepPlace.isInsert(["a", "b"], ["new", "a", "mid", "b", "next"])).toBe(true);
  });

  it("is false for a next page, a link that left, another list and a first load", () => {
    expect(KeepPlace.isInsert(["a", "b"], ["a", "b", "c"])).toBe(false);
    expect(KeepPlace.isInsert(["a", "b"], ["a"])).toBe(false);
    expect(KeepPlace.isInsert(["a", "b"], ["new", "b", "c"])).toBe(false);
    expect(KeepPlace.isInsert(["a", "b"], ["b", "a", "new"])).toBe(false);
    expect(KeepPlace.isInsert([], ["a"])).toBe(false);
    expect(KeepPlace.isInsert(["a"], ["a"])).toBe(false);
  });
});

describe("measure and slide", () => {
  // happy-dom lays nothing out, so each part's top is given.
  const list = (tops: Record<string, number>) => {
    // A mounted element gives the test its document (the global is the platform's alone).
    const root = mount({ render: () => h("div") }).element as HTMLElement;
    const doc = root.ownerDocument;
    const place = new Map<Element, number>();
    const add = (id: string) => {
      const part = doc.createElement("div");
      part.dataset["slot"] = "link-row";
      part.id = id;
      part.getBoundingClientRect = () => ({ top: place.get(part) ?? 0 }) as DOMRect;
      root.append(part);
      return part;
    };
    const rows = Object.fromEntries(
      Object.entries(tops).map(([id, top]) => {
        const part = add(id);
        place.set(part, top);
        return [id, part];
      }),
    );
    return { root, rows, place, add };
  };

  it("draws the rows under a new one where they were, then lets them slide down", () => {
    vi.useFakeTimers();
    const { root, rows, place, add } = list({ a: 100, b: 190 });
    const before = KeepPlace.measure(root);
    expect([...before.values()]).toEqual([100, 190]);

    // A new row on top: the others stand one row lower.
    const fresh = add("new");
    root.prepend(fresh);
    place.set(fresh, 100);
    place.set(rows["a"]!, 190);
    place.set(rows["b"]!, 280);
    KeepPlace.slide(root, before);

    // Sliding to their own place, and the new row is left alone.
    expect([rows["a"]!.style.transform, rows["b"]!.style.transform]).toEqual(["", ""]);
    expect(rows["a"]!.style.transition).toContain("transform");
    expect(rows["b"]!.style.transition).toContain(`${KeepPlace.slideMillis}ms`);
    expect(fresh.style.transition).toBe("");
    vi.advanceTimersByTime(KeepPlace.slideMillis + 50);
    expect(rows["a"]!.style.transition).toBe("");
  });

  it("starts each moved row from where it was", () => {
    const { root, rows, place } = list({ a: 100, b: 190 });
    const before = KeepPlace.measure(root);
    place.set(rows["a"]!, 190);
    place.set(rows["b"]!, 280);
    // The position the browser reads before the slide begins.
    const starts: Array<string> = [];
    root.getBoundingClientRect = () => {
      starts.push(rows["a"]!.style.transform, rows["b"]!.style.transform);
      return {} as DOMRect;
    };
    KeepPlace.slide(root, before);
    expect(starts).toEqual(["translateY(-90px)", "translateY(-90px)"]);
  });

  it("leaves rows that did not move alone", () => {
    const { root, rows } = list({ a: 100, b: 190 });
    const before = KeepPlace.measure(root);
    KeepPlace.slide(root, before);
    expect(rows["a"]!.style.transition).toBe("");
    expect(rows["a"]!.style.transform).toBe("");
  });
});
