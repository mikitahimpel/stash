import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, ref } from "vue";
import DropdownMenu from "../src/dropdown-menu/dropdown-menu.vue";
import DropdownMenuContent from "../src/dropdown-menu/dropdown-menu-content.vue";
import DropdownMenuItem from "../src/dropdown-menu/dropdown-menu-item.vue";
import DropdownMenuLabel from "../src/dropdown-menu/dropdown-menu-label.vue";
import DropdownMenuSeparator from "../src/dropdown-menu/dropdown-menu-separator.vue";
import DropdownMenuTrigger from "../src/dropdown-menu/dropdown-menu-trigger.vue";
import { page } from "./portal";

enableAutoUnmount(afterEach);

const mountMenu = () =>
  mount(
    defineComponent({
      components: {
        DropdownMenu,
        DropdownMenuContent,
        DropdownMenuItem,
        DropdownMenuLabel,
        DropdownMenuSeparator,
        DropdownMenuTrigger,
      },
      setup: () => ({ open: ref(false), selected: ref<Array<string>>([]) }),
      template: `
        <DropdownMenu v-model:open="open">
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Link</DropdownMenuLabel>
            <DropdownMenuItem @select="selected.push('archive')">Archive</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled @select="selected.push('delete')">
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      `,
    }),
    { attachTo: "body" },
  );

const openMenu = async (wrapper: ReturnType<typeof mountMenu>) => {
  await wrapper.find("[data-slot=dropdown-menu-trigger]").trigger("keydown", { key: "Enter" });
  return page(wrapper);
};

const item = (body: ReturnType<typeof page>, label: string) => {
  const found = body.findAll("[role=menuitem]").find((el) => el.text() === label);
  if (found === undefined) throw new Error(`no menu item "${label}"`);
  return found;
};

describe("DropdownMenu", () => {
  it("opens from the trigger", async () => {
    const wrapper = mountMenu();
    expect(page(wrapper).find("[role=menu]").exists()).toBe(false);

    const body = await openMenu(wrapper);

    expect(wrapper.vm.open).toBe(true);
    expect(body.findAll("[role=menuitem]").map((el) => el.text())).toEqual(["Archive", "Delete"]);
  });

  it("emits select and closes when an item is chosen", async () => {
    const wrapper = mountMenu();
    const body = await openMenu(wrapper);

    await item(body, "Archive").trigger("click");

    expect(wrapper.vm.selected).toEqual(["archive"]);
    expect(wrapper.vm.open).toBe(false);
  });

  it("ignores disabled items", async () => {
    const wrapper = mountMenu();
    const body = await openMenu(wrapper);

    const remove = item(body, "Delete");
    expect(remove.attributes("data-variant")).toBe("destructive");
    await remove.trigger("click");

    expect(wrapper.vm.selected).toEqual([]);
    expect(wrapper.vm.open).toBe(true);
  });

  it("closes on Escape", async () => {
    const wrapper = mountMenu();
    const body = await openMenu(wrapper);

    await body.find("[role=menu]").trigger("keydown", { key: "Escape" });

    expect(wrapper.vm.open).toBe(false);
  });
});
