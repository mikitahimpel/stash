import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ScrollRow from "../src/scroll-row/scroll-row.vue";

describe("ScrollRow", () => {
  it("is one sideways-scrolling line on phones and a wrapping row from sm up", () => {
    const row = mount(ScrollRow, {
      slots: { default: "<button>Type</button><button>Date</button>" },
    });
    expect(row.attributes("data-slot")).toBe("scroll-row");
    expect(row.findAll("button")).toHaveLength(2);
    const classes = row.classes();
    // Phones: no wrap (the flex default), horizontal scroll, children keep their width.
    expect(classes).toContain("max-sm:overflow-x-auto");
    expect(classes).toContain("max-sm:[&>*]:shrink-0");
    expect(classes).not.toContain("flex-wrap");
    // Wider screens wrap as before.
    expect(classes).toContain("sm:flex-wrap");
  });
});
