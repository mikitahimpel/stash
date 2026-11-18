<script setup lang="ts">
import { BadgeCheck } from "@lucide/vue";
import Avatar from "../avatar/avatar.vue";

// Who wrote a post: picture, name, a mark for a verified account, and the @handle.
//
// - `row`: one muted line for a `<MediaRow>`'s meta line, with a 16px picture. The name gives way
//   first on a narrow row, then the handle.
// - `card`: the header of a `<PostCard>`: a 40px picture, the name over the handle, and whatever
//   the `meta` slot adds after the handle (a date).
// - `quote`: one line with a 24px picture, for a quoted post.
//
// With `href` the name and the handle open the author's profile.
const props = withDefaults(
  defineProps<{
    name: string;
    /** Without the `@`. */
    handle: string;
    avatar?: string | null | undefined;
    verified?: boolean;
    size?: "row" | "card" | "quote";
    href?: string | undefined;
  }>(),
  { avatar: undefined, verified: false, size: "card", href: undefined },
);

defineSlots<{
  /** After the handle, set off by a middle dot: a date. Not in a `row`. */
  meta?: () => unknown;
}>();
</script>

<template>
  <span
    v-if="size === 'row'"
    data-slot="post-byline"
    data-size="row"
    class="flex min-w-0 items-center gap-1.5"
  >
    <Avatar :src="avatar" :name="name" size="xs" />
    <span data-slot="post-author-name" class="min-w-0 truncate font-medium text-foreground">{{
      name
    }}</span>
    <BadgeCheck
      v-if="verified"
      data-slot="post-verified"
      aria-label="Verified"
      class="size-3.5 shrink-0 text-signal"
    />
    <span data-slot="post-author-handle" class="min-w-0 shrink-[4] truncate">@{{ handle }}</span>
  </span>
  <div
    v-else
    data-slot="post-byline"
    :data-size="size"
    :class="['flex min-w-0 items-center', size === 'card' ? 'gap-3' : 'gap-2']"
  >
    <Avatar :src="avatar" :name="name" :size="size === 'card' ? 'md' : 'sm'" />
    <component
      :is="props.href === undefined ? 'div' : 'a'"
      v-bind="
        props.href === undefined
          ? {}
          : { href: props.href, target: '_blank', rel: 'noopener noreferrer' }
      "
      :class="[
        'group/byline flex min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        size === 'card' ? 'flex-col' : 'items-center gap-1.5',
      ]"
    >
      <span class="flex min-w-0 items-center gap-1">
        <span
          data-slot="post-author-name"
          :class="[
            'min-w-0 truncate text-foreground',
            size === 'card' ? 'text-row-title' : 'text-label',
            props.href !== undefined && 'group-hover/byline:underline',
          ]"
          >{{ name }}</span
        >
        <BadgeCheck
          v-if="verified"
          data-slot="post-verified"
          aria-label="Verified"
          class="size-4 shrink-0 text-signal"
        />
      </span>
      <span
        class="flex min-w-0 items-center text-meta whitespace-nowrap text-muted-foreground [&>*+*]:before:mx-1.5 [&>*+*]:before:content-['·']"
      >
        <span data-slot="post-author-handle" class="min-w-0 truncate">@{{ handle }}</span>
        <slot name="meta" />
      </span>
    </component>
  </div>
</template>
