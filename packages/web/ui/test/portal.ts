import { DOMWrapper, type VueWrapper } from "@vue/test-utils";

/** Dialogs and menus teleport to <body>, outside the wrapper, so tests query the whole page. */
export const page = (wrapper: VueWrapper): DOMWrapper<HTMLElement> =>
  new DOMWrapper(wrapper.element.ownerDocument.body);
