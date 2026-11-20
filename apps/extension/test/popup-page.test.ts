// @vitest-environment happy-dom
import * as Link from "@stash/contracts-domain/link";
import type * as PopupLink from "@stash/ext-popup/popup-link";
import type * as PopupView from "@stash/ext-popup/popup-view";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as PopupActions from "../entrypoints/popup/popup-actions.ts";
import PopupPage from "../entrypoints/popup/popup-page.vue";

// What only the page decides: where the focus goes, and that deleting a link takes a deliberate
// click. Undo is a hard `DELETE /links/:id`, so Enter must never reach it by itself.

enableAutoUnmount(afterEach);

const page: PopupView.Page = {
  url: "https://example.com/a",
  title: "A",
  host: "example.com",
  favIconUrl: null,
  savable: true,
};

const link: PopupLink.PopupLink = {
  id: Link.LinkId.make("link-a"),
  url: "https://example.com/a",
  title: page.title,
  host: page.host,
  imageUrl: null,
  tags: ["reading"],
  savedAt: Date.now(),
  enriched: true,
  post: null,
};

const connection: PopupView.Connection = {
  _tag: "Connected",
  deviceName: "Test browser",
  webOrigin: "https://stash.example.com",
};

const mountPopup = async (options: {
  saved: PopupLink.PopupLink | null;
  created?: boolean;
  recent?: ReadonlyArray<PopupLink.PopupLink>;
}) => {
  const actions = {
    page: vi.fn(async () => page),
    load: vi.fn(async () => ({
      connection,
      saved: options.saved,
      recent: options.recent ?? (options.saved === null ? [] : [options.saved]),
    })),
    save: vi.fn(async () => ({
      _tag: "Saved" as const,
      link,
      created: options.created ?? true,
    })),
    undo: vi.fn(async () => ({ _tag: "Removed" as const })),
    watch: vi.fn(async () => {}),
    catchUp: vi.fn(async () => {}),
    openStash: vi.fn(async () => {}),
    search: vi.fn(async () => {}),
    openLink: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
  } satisfies PopupActions.Actions;
  const wrapper = mount(PopupPage, { props: { actions }, attachTo: "body" });
  await flushPromises();
  const focused = () => wrapper.element.ownerDocument.activeElement;
  /** Enter on the focused element: it activates a button, and does nothing to delete elsewhere. */
  const pressEnter = async () => {
    const element = focused();
    if (element instanceof HTMLButtonElement) element.click();
    await flushPromises();
  };
  const field = () => wrapper.find("input[type=search]").element;
  return { wrapper, actions, focused, pressEnter, field };
};

describe("popup page", () => {
  it("focuses Save on a new page, and the search field once the page is saved", async () => {
    const { wrapper, actions, focused, pressEnter, field } = await mountPopup({ saved: null });
    expect(focused()?.textContent?.trim()).toBe("Save");

    await pressEnter();
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(wrapper.find("button[name=undo]").exists()).toBe(true);
    expect(focused()).toBe(field());

    // Enter again, or a held Enter, does not take the page out again.
    await pressEnter();
    await pressEnter();
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it("does not let a held Enter run on into the search", async () => {
    const { actions, field } = await mountPopup({ saved: link });
    const held = new KeyboardEvent("keydown", { key: "Enter", repeat: true, cancelable: true });
    field().dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
    const pressed = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    field().dispatchEvent(pressed);
    expect(pressed.defaultPrevented).toBe(false);
    expect(actions.search).not.toHaveBeenCalled();
  });

  it("undoes a link this popup just created with one click", async () => {
    const { wrapper, actions, focused } = await mountPopup({ saved: null, created: true });
    await wrapper.find("button.wide").trigger("click");
    await flushPromises();

    await wrapper.find("button[name=undo]").trigger("click");
    await flushPromises();
    expect(actions.undo).toHaveBeenCalledExactlyOnceWith(link.id);
    expect(wrapper.find("button[name=undo]").exists()).toBe(false);
    expect(focused()?.textContent?.trim()).toBe("Save");
  });

  it("never focuses Remove on a page saved earlier, and asks before deleting it", async () => {
    const { wrapper, actions, focused, pressEnter, field } = await mountPopup({ saved: link });
    expect(focused()).toBe(field());
    expect(wrapper.find("button[name=undo]").exists()).toBe(false);
    await pressEnter();
    expect(actions.undo).not.toHaveBeenCalled();

    // Remove only asks. The focus is on Keep, so Enter there deletes nothing either.
    await wrapper.find("button[name=remove]").trigger("click");
    expect(actions.undo).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Remove from Stash?");
    expect(focused()?.textContent?.trim()).toBe("Keep");
    await pressEnter();
    expect(actions.undo).not.toHaveBeenCalled();
    expect(wrapper.find("button[name=remove]").exists()).toBe(true);
    expect(focused()).toBe(field());

    await wrapper.find("button[name=remove]").trigger("click");
    await wrapper.find("button[name=confirm-remove]").trigger("click");
    await flushPromises();
    expect(actions.undo).toHaveBeenCalledExactlyOnceWith(link.id);
    expect(wrapper.text()).not.toContain("Saved");
  });

  it("asks as well when Save found the page in Stash already", async () => {
    const { wrapper, actions } = await mountPopup({ saved: null, created: false });
    await wrapper.find("button.wide").trigger("click");
    await flushPromises();
    expect(wrapper.find("button[name=undo]").exists()).toBe(false);
    await wrapper.find("button[name=remove]").trigger("click");
    expect(actions.undo).not.toHaveBeenCalled();
    expect(wrapper.find("button[name=confirm-remove]").exists()).toBe(true);
  });

  it("shows a post on X in a post's order, and one that could not be read as unavailable", async () => {
    const post: PopupLink.PopupLink = {
      ...link,
      id: Link.LinkId.make("post"),
      url: "https://x.com/ada_example/status/1",
      title: "Ada Example: Words of the post",
      host: "x.com",
      post: {
        state: "available",
        name: "Ada Example",
        handle: "ada_example",
        avatarUrl: "https://images.example.com/ada.jpg",
        verified: true,
        text: "Words of the post",
        previewUrl: "https://images.example.com/photo.jpg",
        video: false,
      },
    };
    const gone: PopupLink.PopupLink = {
      ...link,
      id: Link.LinkId.make("gone"),
      url: "https://x.com/i/status/2",
      title: "Ben Example: an old post",
      host: "x.com",
      post: { state: "unavailable" },
    };
    const { wrapper } = await mountPopup({ saved: null, recent: [post, gone] });
    const [row, other] = wrapper.findAll(".recent a");
    expect(row!.find(".byline").text()).toContain("Ada Example");
    expect(row!.find(".byline").text()).toContain("@ada_example");
    expect(row!.find(".post-text").text()).toBe("Words of the post");
    expect(row!.find(".row-title").exists()).toBe(false);
    // The byline comes before the words.
    const text = row!.text();
    expect(text.indexOf("@ada_example")).toBeLessThan(text.indexOf("Words of the post"));
    for (const image of row!.findAll("img")) {
      expect(image.attributes("loading")).toBe("lazy");
      expect(image.attributes("referrerpolicy")).toBe("no-referrer");
    }
    expect(other!.text()).toContain("Ben Example: an old post");
    expect(other!.text()).toContain("Post unavailable");
  });
});
