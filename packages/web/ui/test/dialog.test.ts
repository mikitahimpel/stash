import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, ref } from "vue";
import Dialog from "../src/dialog/dialog.vue";
import DialogClose from "../src/dialog/dialog-close.vue";
import DialogContent from "../src/dialog/dialog-content.vue";
import DialogDescription from "../src/dialog/dialog-description.vue";
import DialogTitle from "../src/dialog/dialog-title.vue";
import DialogTrigger from "../src/dialog/dialog-trigger.vue";
import { page } from "./portal";

enableAutoUnmount(afterEach);

const mountDialog = (showCloseButton = true) =>
  mount(
    defineComponent({
      components: {
        Dialog,
        DialogClose,
        DialogContent,
        DialogDescription,
        DialogTitle,
        DialogTrigger,
      },
      setup: () => ({ open: ref(false), showCloseButton }),
      template: `
        <Dialog v-model:open="open">
          <DialogTrigger>Edit link</DialogTrigger>
          <DialogContent :show-close-button="showCloseButton">
            <DialogTitle>Edit link</DialogTitle>
            <DialogDescription>Change the title of https://example.com/article</DialogDescription>
            <DialogClose data-test="cancel">Cancel</DialogClose>
          </DialogContent>
        </Dialog>
      `,
    }),
    { attachTo: "body" },
  );

const openDialog = async (wrapper: ReturnType<typeof mountDialog>) => {
  await wrapper.find("[data-slot=dialog-trigger]").trigger("click");
  return page(wrapper);
};

describe("Dialog", () => {
  it("is closed until the trigger is clicked", async () => {
    const wrapper = mountDialog();
    expect(page(wrapper).find("[role=dialog]").exists()).toBe(false);

    const body = await openDialog(wrapper);

    expect(wrapper.vm.open).toBe(true);
    const dialog = body.find("[role=dialog]");
    expect(dialog.exists()).toBe(true);
    expect(dialog.text()).toContain("Change the title of https://example.com/article");
  });

  it("stays modal unless told otherwise, hiding the rest of the page from assistive tech", async () => {
    const wrapper = mountDialog();
    await openDialog(wrapper);

    // An unset boolean prop must not reach reka-ui as `modal: false`.
    expect(wrapper.element.closest("[data-v-app]")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("closes from the built-in close button", async () => {
    const wrapper = mountDialog();
    const body = await openDialog(wrapper);

    await body.find("[data-slot=dialog-close]").trigger("click");

    expect(wrapper.vm.open).toBe(false);
    expect(body.find("[role=dialog]").exists()).toBe(false);
  });

  it("closes from a DialogClose placed in the content", async () => {
    const wrapper = mountDialog();
    const body = await openDialog(wrapper);

    await body.find("[data-test=cancel]").trigger("click");

    expect(wrapper.vm.open).toBe(false);
  });

  it("closes on Escape", async () => {
    const wrapper = mountDialog();
    const body = await openDialog(wrapper);

    await body.find("[role=dialog]").trigger("keydown", { key: "Escape" });

    expect(wrapper.vm.open).toBe(false);
  });

  it("can hide the built-in close button", async () => {
    const wrapper = mountDialog(false);
    const body = await openDialog(wrapper);

    expect(body.find("[role=dialog]").exists()).toBe(true);
    // Only the Cancel button from the content is left.
    expect(body.findAll("[data-slot=dialog-close]").map((close) => close.text())).toEqual([
      "Cancel",
    ]);
  });
});
