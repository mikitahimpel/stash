// Runs inside the page (Playwright serialises it), so it uses nothing from outside its own body:
// it measures the controls, page-level blocks, gaps, cards and fonts that
// `layout-audit-rules.ts` checks. It reaches the document through the element it is given.
import type { Block, Control, Snapshot } from "./layout-audit-rules.ts";

export const probe = (body: HTMLElement): Snapshot => {
  const doc = body.ownerDocument;
  const view = doc.defaultView!;
  const css = (el: Element, pseudo?: string) => view.getComputedStyle(el, pseudo);
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left + view.scrollX,
      right: r.right + view.scrollX,
      top: r.top + view.scrollY,
      bottom: r.bottom + view.scrollY,
      height: r.height,
    };
  };
  const visible = (el: Element): boolean => {
    const s = css(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    if (s.display === "contents") return true;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };
  const label = (el: Element): string => {
    const attrs = ["data-slot", "data-test", "data-action", "data-section", "aria-label"]
      .map((name) => el.getAttribute(name))
      .filter((value) => value !== null && value !== "")
      .slice(0, 2);
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 28);
    return `${el.tagName.toLowerCase()}${attrs.map((a) => `[${a}]`).join("")}${text ? ` "${text}"` : ""}`;
  };
  const transparent = (color: string) =>
    color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color) || color.endsWith("/ 0)");
  // A surface shows its own box: a background, or a visible border on its left side.
  const surface = (el: Element): boolean => {
    const s = css(el);
    if (!transparent(s.backgroundColor) || s.backgroundImage !== "none") return true;
    return parseFloat(s.borderLeftWidth) > 0 && !transparent(s.borderLeftColor);
  };

  // A box that clips its content (scrolling chip rows, truncated titles) ends where it ends, not
  // where its text would.
  const clips = (el: Element) => ["auto", "scroll", "hidden", "clip"].includes(css(el).overflowX);
  // The right end of these is meant to sit on the content edge.
  const endAligned =
    "[data-slot=list-row-trailing], [data-slot=section-header-actions], [data-slot=page-header-actions], [data-slot=app-bar-inner] > :last-child";
  const controlSlots = new Set(["input", "search-field", "segmented-control", "toggle-chip"]);
  // Ink that counts by its box, not its text: controls, fields, keys, graphics, row ranks.
  const inkBox = (el: Element): boolean =>
    el.matches(
      "button, [role=radio], [role=tab], svg, img, kbd, output, [data-slot=list-row-leading], [data-slot=device-code]",
    ) ||
    controlSlots.has(el.getAttribute("data-slot") ?? "") ||
    surface(el) ||
    clips(el);

  /** The first and last ink of a block, and whether the last is a box. */
  const ink = (el: Element) => {
    let left: number | null = null;
    let right: number | null = null;
    let rightIsBox = false;
    const add = (l: number, r: number, isBox: boolean) => {
      if (left === null || l < left) left = l;
      if (right === null || r > right) {
        right = r;
        rightIsBox = isBox;
      }
    };
    const walk = (node: Node) => {
      if (node.nodeType === 3) {
        if ((node.textContent ?? "").trim() === "") return;
        const range = doc.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width > 0) add(r.left + view.scrollX, r.right + view.scrollX, false);
        }
        return;
      }
      if (!(node instanceof view.Element) || !visible(node)) return;
      if (css(node).position === "fixed") return;
      if (inkBox(node)) {
        const b = box(node);
        add(b.left, b.right, node.closest(endAligned) !== null);
        return;
      }
      node.childNodes.forEach(walk);
    };
    el.childNodes.forEach(walk);
    return { left, right, rightIsBox };
  };

  const main = body.querySelector("main");
  if (main === null) throw new Error("no <main> on the page");
  const mainStyle = css(main);
  const mainBox = box(main);
  const content = {
    left: mainBox.left + parseFloat(mainStyle.paddingLeft),
    right: mainBox.right - parseFloat(mainStyle.paddingRight),
  };

  // Kit components that are one block, whatever their insides look like.
  const leaves = new Set([
    "page-header",
    "section-header",
    "card",
    "empty-state",
    "saved-read-chart",
    "tab-age-chart",
  ]);
  const stacks = (el: Element): boolean => {
    const s = css(el);
    if (s.display === "block") return true;
    if (s.display === "flex") return s.flexDirection.startsWith("column");
    if (s.display === "grid") return s.gridTemplateColumns.trim().split(/\s+/).length === 1;
    return false;
  };
  const ownText = (el: Element) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
  const container = (el: Element): boolean =>
    !leaves.has(el.getAttribute("data-slot") ?? "") &&
    !el.hasAttribute("data-list-row") &&
    ["DIV", "SECTION", "UL", "OL", "FORM", "ARTICLE", "MAIN"].includes(el.tagName) &&
    !surface(el) &&
    !ownText(el) &&
    el.children.length > 0 &&
    stacks(el);
  const centered = (el: Element): boolean => {
    const s = css(el);
    return (
      s.textAlign === "center" ||
      (s.display === "flex" && s.flexDirection.startsWith("column") && s.alignItems === "center")
    );
  };

  const blocks: Array<Block> = [];
  const blockOf = new Map<Element, number>();
  const gaps: Array<{ label: string; px: number }> = [];
  const groups: Array<Snapshot["groups"][number]> = [];

  // The lines of a list row, each by where it starts: the title, the meta when it wraps under the
  // title (phones), and every extra line (summary, tags, the action bar).
  const rowLines = (row: Element) => {
    const title = row.querySelector("[data-slot=list-row-title]");
    const titleLine = row.querySelector("[data-slot=list-row-title-line]");
    const meta = row.querySelector("[data-slot=list-row-meta]");
    const body = titleLine?.parentElement ?? null;
    const lines: Array<Element> = [];
    if (title !== null && visible(title)) lines.push(title);
    if (meta !== null && visible(meta) && title !== null) {
      if (box(meta).top >= box(title).bottom - 0.5) lines.push(meta);
    }
    if (body !== null) {
      for (const child of body.children)
        if (child !== titleLine && visible(child)) lines.push(child);
    }
    return lines.map((line) => ({ label: label(line), left: ink(line).left ?? box(line).left }));
  };
  // Where a row starts: its leading slot (a rank), else its first line.
  const rowLeft = (row: Element): number | null => {
    const leading = row.querySelector("[data-slot=list-row-leading]");
    if (leading !== null && visible(leading)) return box(leading).left;
    return rowLines(row)[0]?.left ?? ink(row).left;
  };

  // Features may rename a row's data-slot (`link-row`); `data-list-row` always marks a ListRow.
  const isRow = (el: Element) => el.hasAttribute("data-list-row");

  const addBlock = (el: Element, isCentered: boolean) => {
    const id = blocks.length;
    blockOf.set(el, id);
    const slot = el.getAttribute("data-slot");
    const row = isRow(el);
    const own = (surface(el) || clips(el) || el.matches("svg, img, canvas")) && !row;
    const measured = own ? { ...box(el), rightIsBox: true } : ink(el);
    blocks.push({
      label: label(el),
      left: row ? rowLeft(el) : measured.left,
      right: measured.right,
      rightIsBox: measured.rightIsBox,
      centered: isCentered,
    });
    if (row) groups.push({ kind: "row", label: label(el), edges: rowLines(el) });
    if (slot === "card") {
      const parts = [...el.querySelectorAll("[data-slot=card-title], [data-list-row]")];
      groups.push({
        kind: "card",
        label: label(el),
        edges: parts.filter(visible).map((part) => ({
          label: label(part),
          left: (isRow(part) ? rowLeft(part) : ink(part).left) ?? box(part).left,
        })),
      });
      for (const inner of el.querySelectorAll("[data-list-row]")) {
        if (visible(inner))
          groups.push({ kind: "row", label: label(inner), edges: rowLines(inner) });
      }
    }
  };

  const walk = (el: Element, inCentered: boolean) => {
    const children = [...el.children].filter(
      (child) => visible(child) && !["absolute", "fixed"].includes(css(child).position),
    );
    // Vertical gaps between stacked siblings.
    children.forEach((child, i) => {
      const next = children[i + 1];
      if (next === undefined) return;
      const a = box(child);
      const b = box(next);
      if (b.top >= a.bottom - 0.5)
        gaps.push({ label: `${label(child)} → ${label(next)}`, px: b.top - a.bottom });
    });
    const isCentered = inCentered || centered(el);
    for (const child of children) {
      if (css(child).display === "contents" || container(child)) walk(child, isCentered);
      else addBlock(child, isCentered || centered(child));
    }
  };
  walk(main, false);

  // The app bar's row sits on the same edges as the content.
  const bar = body.querySelector("[data-slot=app-bar-inner]");
  if (bar !== null && visible(bar)) addBlock(bar, false);

  const nearestBlock = (el: Element): number => {
    for (let at: Element | null = el; at !== null; at = at.parentElement) {
      const id = blockOf.get(at);
      if (id !== undefined) return id;
    }
    return -1;
  };

  const controls: Array<Control> = [];
  for (const el of body.querySelectorAll(
    "button, input, [role=tab], [role=menuitem], [role=radio], a[data-row]",
  )) {
    if (el.matches("input[type=hidden]")) continue;
    const target = el.matches("input")
      ? (el.closest("[data-slot=input], [data-slot=search-field]") ?? el)
      : el;
    if (!visible(target) || target.closest("[aria-hidden=true]") !== null) continue;
    const b = box(target);
    const after = css(target, "::after");
    const hit =
      after.content !== "none" && after.position === "absolute"
        ? Math.max(b.height, parseFloat(after.height) || 0)
        : b.height;
    controls.push({
      label: label(target),
      block: nearestBlock(target),
      top: b.top,
      height: b.height,
      hit,
      row: el.matches("a[data-row]"),
    });
  }

  // Mono text outside the allowlist.
  const mono: Array<string> = [];
  for (const el of body.querySelectorAll("*")) {
    if (!ownText(el) || !visible(el)) continue;
    if (!css(el).fontFamily.includes("Mono")) continue;
    if (el.closest("kbd, svg, [data-slot=device-code]") !== null) continue;
    mono.push(label(el));
  }

  return { content, controls, blocks, gaps, groups, mono };
};
