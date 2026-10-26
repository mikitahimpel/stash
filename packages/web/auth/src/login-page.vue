<script setup lang="ts">
import { LogIn } from "@lucide/vue";
import Button from "@stash/web-ui/button";
import Card from "@stash/web-ui/card";
import CardContent from "@stash/web-ui/card-content";
import CardDescription from "@stash/web-ui/card-description";
import CardHeader from "@stash/web-ui/card-header";
import CardTitle from "@stash/web-ui/card-title";
import * as LoginUrl from "./login-url.ts";
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
    <Card class="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Stash</CardTitle>
        <CardDescription>Sign in to see your links and open tabs.</CardDescription>
      </CardHeader>
      <CardContent>
        <!-- A full page load: the api runs the OAuth flow and redirects back with a session. -->
        <Button as-child class="w-full">
          <a :href="LoginUrl.github">
            <LogIn aria-hidden="true" />
            Sign in with GitHub
          </a>
        </Button>
      </CardContent>
    </Card>
  </div>
</template>
