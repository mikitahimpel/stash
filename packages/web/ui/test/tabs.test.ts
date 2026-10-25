import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, ref } from "vue";
import Tabs from "../src/tabs/tabs.vue";
import TabsContent from "../src/tabs/tabs-content.vue";
import TabsList from "../src/tabs/tabs-list.vue";
import TabsTrigger from "../src/tabs/tabs-trigger.vue";

enableAutoUnmount(afterEach);

const mountTabs = () =>
  mount(
    defineComponent({
      components: { Tabs, TabsContent, TabsList, TabsTrigger },
      setup: () => ({ tab: ref("recent") }),
      template: `
        <Tabs v-model="tab">
          <TabsList>
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="unseen">Not yet seen</TabsTrigger>
          </TabsList>
          <TabsContent value="recent">Recent links</TabsContent>
          <TabsContent value="unseen">Unseen links</TabsContent>
        </Tabs>
      `,
    }),
  );

const trigger = (wrapper: ReturnType<typeof mountTabs>, label: string) => {
  const found = wrapper.findAll("[role=tab]").find((el) => el.text() === label);
  if (found === undefined) throw new Error(`no tab "${label}"`);
  return found;
};

// Inactive panels stay in the DOM with an empty, `hidden` element.
const visiblePanels = (wrapper: ReturnType<typeof mountTabs>) =>
  wrapper.findAll("[role=tabpanel]:not([hidden])").map((el) => el.text());

describe("Tabs", () => {
  it("shows only the panel of the active tab", () => {
    const wrapper = mountTabs();

    expect(visiblePanels(wrapper)).toEqual(["Recent links"]);
    expect(trigger(wrapper, "Recent").attributes("data-state")).toBe("active");
  });

  it("switches panels when another tab is activated", async () => {
    const wrapper = mountTabs();

    await trigger(wrapper, "Not yet seen").trigger("mousedown", { button: 0 });

    expect(wrapper.vm.tab).toBe("unseen");
    expect(visiblePanels(wrapper)).toEqual(["Unseen links"]);
    expect(trigger(wrapper, "Recent").attributes("data-state")).toBe("inactive");
  });
});
