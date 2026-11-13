<template>
  <kbd
    data-slot="nav-shortcut"
    aria-hidden="true"
    class="hidden font-mono text-key font-normal text-muted-foreground sm:inline"
  >
    <!-- A keyboard hint inside a nav tab, such as `⌘K`. Hidden on phones, which have no keyboard. --><slot
  /></kbd>
</template>
