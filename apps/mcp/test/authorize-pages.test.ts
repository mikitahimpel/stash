import { describe, expect, it } from "vitest";
import * as Pages from "../src/authorize-pages.ts";

const page = Pages.device(
  {
    state: "state-1",
    userCode: "ABCD-1234",
    verificationUri: "https://github.com/login/device",
    interval: 5,
    pollPath: "/authorize/poll",
  },
  "nonce-1",
);

describe("the sign-in pages", () => {
  it("show the logo inline, within what the page's CSP allows", () => {
    const mark = /<p class="mark">(<svg[\s\S]*?<\/svg>)<span>stash<\/span><\/p>/.exec(page)?.[1];
    expect(mark).toBeDefined();
    // `default-src 'none'` with nonce'd styles: no image, no <use> and no inline style attribute.
    expect(page).not.toMatch(/<img|<image|href="#|\sstyle="/);
    const ids = [...(mark ?? "").matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    for (const [, ref] of (mark ?? "").matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(ref);
    expect(page).toContain(".glow{mix-blend-mode:screen}");
  });
});
