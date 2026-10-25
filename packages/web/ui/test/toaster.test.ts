import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToastMessage } from "../src/toast/toast-message";
import Toaster from "../src/toast/toaster.vue";
import { page } from "./portal";

enableAutoUnmount(afterEach);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const toasts: ReadonlyArray<ToastMessage> = [
  { id: "saved", title: "Link saved", description: "https://example.com/article" },
  { id: "failed", title: "Could not archive", variant: "destructive", duration: 1000 },
];

const mountToaster = async () => {
  const wrapper = mount(Toaster, { props: { toasts, duration: 3000 }, attachTo: "body" });
  // The toasts render into the viewport once it has mounted.
  await flushPromises();
  return wrapper;
};

describe("Toaster", () => {
  it("renders every message it is given", async () => {
    const wrapper = await mountToaster();

    const rendered = page(wrapper).findAll("[data-slot=toast]");
    expect(
      rendered.map((toast) => [
        toast.find("[data-slot=toast-title]").text(),
        toast.find("[data-slot=toast-description]").exists()
          ? toast.find("[data-slot=toast-description]").text()
          : undefined,
      ]),
    ).toEqual([
      ["Link saved", "https://example.com/article"],
      ["Could not archive", undefined],
    ]);
    expect(rendered.map((toast) => toast.attributes("data-variant"))).toEqual([
      "default",
      "destructive",
    ]);
  });

  it("emits dismiss with the id when a toast is closed", async () => {
    const wrapper = await mountToaster();

    await page(wrapper).findAll("[data-slot=toast-close]")[0]?.trigger("click");

    expect(wrapper.emitted("dismiss")).toEqual([["saved"]]);
  });

  it("emits dismiss when a toast times out, honouring its own duration", async () => {
    const wrapper = await mountToaster();

    await vi.advanceTimersByTimeAsync(1500);
    expect(wrapper.emitted("dismiss")).toEqual([["failed"]]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.emitted("dismiss")).toEqual([["failed"], ["saved"]]);
  });
});
