// Runs inside the page (Playwright serialises each function), so nothing here uses anything from
// outside its own body. It records the page's layout shifts and measures boxes, reaching the
// document through the element it is given.

/** A box on the page, in CSS pixels from the top left of the document. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The layout shifts of the page so far. */
export interface Shifts {
  /** Cumulative Layout Shift: the sum of the shifts that no input caused. */
  readonly cls: number;
  /** What moved, for the report: the element and how far its top went. */
  readonly moved: ReadonlyArray<string>;
}

interface Recorded {
  cls: number;
  moved: Array<string>;
}

/** Starts to record layout shifts, with the ones the page already had. Run it before the app. */
export const record = (): void => {
  const view = globalThis as unknown as { __shifts?: Recorded };
  const recorded: Recorded = { cls: 0, moved: [] };
  view.__shifts = recorded;
  const name = (node: Node | null): string => {
    if (node === null || !("getAttribute" in node)) return "(gone)";
    const el = node as Element;
    const slot = el.getAttribute("data-slot") ?? el.getAttribute("data-test");
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
    return `${el.tagName.toLowerCase()}${slot === null ? "" : `[${slot}]`} "${text}"`;
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const shift = entry as unknown as {
        readonly value: number;
        readonly hadRecentInput: boolean;
        readonly sources?: ReadonlyArray<{
          readonly node: Node | null;
          readonly previousRect: DOMRectReadOnly;
          readonly currentRect: DOMRectReadOnly;
        }>;
      };
      if (shift.hadRecentInput) continue;
      recorded.cls += shift.value;
      for (const source of shift.sources ?? []) {
        const dy = Math.round(source.currentRect.top - source.previousRect.top);
        const dx = Math.round(source.currentRect.left - source.previousRect.left);
        recorded.moved.push(`${name(source.node)} moved ${dx},${dy}`);
      }
    }
  }).observe({ type: "layout-shift", buffered: true });
};

export const shifts = (body: HTMLElement): Shifts => {
  const view = body.ownerDocument.defaultView as unknown as { __shifts?: Recorded };
  return { cls: view.__shifts?.cls ?? 0, moved: [...(view.__shifts?.moved ?? [])] };
};

/** The boxes of the first element that matches each selector; `null` where there is none. */
export const boxes = (
  body: HTMLElement,
  selectors: Readonly<Record<string, string>>,
): Record<string, Box | null> => {
  const view = body.ownerDocument.defaultView!;
  const found: Record<string, Box | null> = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const el = body.querySelector(selector);
    if (el === null) {
      found[name] = null;
      continue;
    }
    const rect = el.getBoundingClientRect();
    found[name] = {
      x: rect.left + view.scrollX,
      y: rect.top + view.scrollY,
      width: rect.width,
      height: rect.height,
    };
  }
  return found;
};
