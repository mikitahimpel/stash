import { onScopeDispose, readonly, ref, watch, type Ref, type WatchSource } from "vue";

/** How long a load may take before a page shows its skeleton. */
export const defaultDelayMillis = 150;

/** How long a skeleton stays once it is shown, so it never flashes. */
export const defaultMinMillis = 300;

/**
 * Whether to show a loading skeleton. It turns `true` only once `loading` has stayed true for
 * `delayMillis`: a load that finishes sooner never shows one. Once shown it stays for at least
 * `minMillis`, also when the load ends sooner, so a skeleton never flashes by. A page shows the
 * skeleton while this is true, and what it loaded after.
 */
export const useDelayedLoading = (
  loading: WatchSource<boolean>,
  delayMillis = defaultDelayMillis,
  minMillis = defaultMinMillis,
): Readonly<Ref<boolean>> => {
  const shown = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shownAt = 0;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const show = () => {
    timer = undefined;
    shownAt = Date.now();
    shown.value = true;
  };
  const hide = () => {
    timer = undefined;
    shown.value = false;
  };
  watch(
    loading,
    (value) => {
      cancel();
      if (value) {
        if (!shown.value) timer = setTimeout(show, delayMillis);
      } else if (shown.value) {
        const left = minMillis - (Date.now() - shownAt);
        if (left > 0) timer = setTimeout(hide, left);
        else hide();
      }
    },
    { immediate: true },
  );
  onScopeDispose(cancel);
  return readonly(shown);
};
