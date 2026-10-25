import { useForwardProps } from "reka-ui";
import { type ComputedRef, computed } from "vue";

/** `T` without the keys `K`, and with every prop that may be `undefined` made optional instead. */
export type ForwardedProps<T, K extends keyof T> = {
  [P in Exclude<keyof T, K> as undefined extends T[P] ? never : P]: T[P];
} & {
  [P in Exclude<keyof T, K> as undefined extends T[P] ? P : never]?: Exclude<T[P], undefined>;
};

/**
 * The props a wrapper passes down to its reka-ui primitive. `omit` drops the wrapper's own props
 * (such as `class`). Like reka-ui's `useForwardProps`, it leaves out props the caller did not set, so
 * the primitive keeps its defaults. The result type has no `undefined` values, which
 * `exactOptionalPropertyTypes` requires at the `v-bind`.
 */
export const useForwardedProps = <T extends object, K extends keyof T = never>(
  props: T,
  omit: ReadonlyArray<K> = [],
): ComputedRef<ForwardedProps<T, K>> => {
  const forwarded = useForwardProps(props as Record<string, unknown>);
  const omitted: ReadonlyArray<PropertyKey> = omit;
  return computed(
    () =>
      Object.fromEntries(
        Object.entries(forwarded.value).filter(
          ([key, value]) => value !== undefined && !omitted.includes(key),
        ),
      ) as ForwardedProps<T, K>,
  );
};
