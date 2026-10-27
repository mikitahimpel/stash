<script setup lang="ts">
import Button from "@stash/web-ui/button";
import * as LoginUrl from "./login-url.ts";
</script>

<template>
  <main
    class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 text-foreground"
  >
    <h1 class="text-[15px] font-semibold tracking-tight">stash</h1>
    <!-- A full page load: the api runs the OAuth flow and redirects back with a session. -->
    <Button as-child variant="primary" size="lg">
      <a :href="LoginUrl.github">Sign in with GitHub</a>
    </Button>
    <p class="font-mono text-xs text-muted-foreground">continues on github.com</p>
  </main>
</template>
