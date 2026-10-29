import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ErrorState from "../src/error-state/error-state.vue";

describe("ErrorState", () => {
  it("says what failed and offers a raised Retry key", async () => {
    const wrapper = mount(ErrorState, { props: { title: "Couldn't load open tabs" } });

    expect(wrapper.attributes("role")).toBe("alert");
    expect(wrapper.find("h3").text()).toBe("Couldn't load open tabs");
    const retry = wrapper.find("button[data-action=retry]");
    expect(retry.text()).toBe("Retry");
    expect(retry.classes()).toContain("tactile-raised");
    await retry.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });
});
