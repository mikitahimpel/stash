// Runs inside the page (Playwright serialises each function), so nothing here uses anything from
// outside its own body. It times a switch between pages from the click to the first frame that
// shows what the switch is waiting for, and notes every skeleton and blank page area on the way.
// It reaches the document through the element it is given.

/** What one switch looked like. Times are ms after the click. */
export interface Switch {
  /** The first frame with the page title of the tab (its layout), or `null` before it. */
  readonly layout: number | null;
  /** The first frame with the tab's rows (its data), or `null` before it. */
  readonly painted: number | null;
  /** Skeletons were on screen at some point after the click. */
  readonly skeleton: boolean;
  /** The page area had no content in some frame after the click. */
  readonly blank: boolean;
  /** How far the page was scrolled in the frame that painted. */
  readonly scrollY: number;
}

interface Watch {
  click: number | undefined;
  layout: number | null;
  painted: number | null;
  skeleton: boolean;
  blank: boolean;
  scrollY: number;
  stop: () => void;
}

/**
 * Starts to watch for the tab: an `h1` that says `title`, and the rows that match `rows`. The next
 * click is the start of the switch. Skeletons and blank frames are recorded until `read`.
 */
export const arm = (
  body: HTMLElement,
  { title, rows }: { readonly title: string; readonly rows: string },
): void => {
  const doc = body.ownerDocument;
  const view = doc.defaultView! as unknown as Window & { __tabSwitch?: Watch };
  view.__tabSwitch?.stop();
  const watch: Watch = {
    click: undefined,
    layout: null,
    painted: null,
    skeleton: false,
    blank: false,
    scrollY: 0,
    stop: () => {
      observer.disconnect();
      doc.removeEventListener("click", onClick, true);
    },
  };
  // The frame that holds the element, then a task after it: the frame is on screen by then.
  const afterPaint = (done: (millis: number) => void) =>
    view.requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => done(view.performance.now() - watch.click!);
      channel.port2.postMessage(null);
    });
  const seen = { layout: false, rows: false };
  const look = () => {
    if (watch.click === undefined) return;
    if (doc.querySelector("[data-slot=skeleton]") !== null) watch.skeleton = true;
    const main = doc.querySelector("[data-slot=app-main]");
    if (main !== null && main.childElementCount === 0) watch.blank = true;
    if (
      !seen.layout &&
      [...doc.querySelectorAll("h1")].some((h1) => (h1.textContent ?? "").trim() === title)
    ) {
      seen.layout = true;
      afterPaint((millis) => (watch.layout = millis));
    }
    if (!seen.rows && doc.querySelector(rows) !== null) {
      seen.rows = true;
      afterPaint((millis) => {
        watch.painted = millis;
        watch.scrollY = view.scrollY;
      });
    }
  };
  const observer = new MutationObserver(look);
  // `timeStamp` is when the browser got the click, before any handler ran.
  const onClick = (event: Event) => {
    if (watch.click !== undefined) return;
    watch.click = event.timeStamp;
    // The router may render in this very task: look once it is over.
    view.queueMicrotask(look);
  };
  observer.observe(body, { childList: true, subtree: true, attributes: true });
  doc.addEventListener("click", onClick, true);
  view.__tabSwitch = watch;
};

/** The switch so far. */
export const read = (body: HTMLElement): Switch => {
  const view = body.ownerDocument.defaultView! as unknown as Window & { __tabSwitch?: Watch };
  const watch = view.__tabSwitch!;
  return {
    layout: watch.layout,
    painted: watch.painted,
    skeleton: watch.skeleton,
    blank: watch.blank,
    scrollY: watch.scrollY,
  };
};
