import { onScopeDispose, readonly, ref, watch, type Ref, type WatchSource } from "vue";

/** How long a load may take before a page shows its skeleton. */
export const defaultDelayMillis = 200;

/**
 * Whether to show a loading skeleton: `true` only once `loading` has stayed true for `delayMillis`.
 * A load that finishes sooner never shows one, so fast answers don't flash a skeleton. It turns
 * false as soon as `loading` does.
 */
export const useDelayedLoading = (
  loading: WatchSource<boolean>,
  delayMillis = defaultDelayMillis,
): Readonly<Ref<boolean>> => {
  const shown = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  watch(
    loading,
    (value) => {
      cancel();
      if (!value) shown.value = false;
      else if (!shown.value) timer = setTimeout(() => (shown.value = true), delayMillis);
    },
    { immediate: true },
  );
  onScopeDispose(cancel);
  return readonly(shown);
};
