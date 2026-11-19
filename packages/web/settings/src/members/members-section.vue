<script setup lang="ts">
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-vue";
import type * as Members from "@stash/contracts-api/members";
import type * as Invite from "@stash/contracts-domain/invite";
import * as PageOrigin from "@stash/web-platform/page-origin";
import Button from "@stash/web-ui/button";
import ListRow from "@stash/web-ui/list-row";
import ListRowTitle from "@stash/web-ui/list-row-title";
import SectionHeader from "@stash/web-ui/section-header";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { computed, ref } from "vue";
import * as SettingsRows from "../settings-rows.ts";
import ConfirmDialog from "./confirm-dialog.vue";
import InviteLinkDialog from "./invite-link-dialog.vue";
import * as MembersAtoms from "./members-atoms.ts";

// The last sections of Settings (#177), so nothing above moves when they arrive:
//
// - "AI summaries", for a user with a daily cap that is used up or close to it: a quiet line.
// - "Members", for the owner only: who is here, removing someone (with everything they stored),
//   and invite links.
//
// A member sees no Members section at all: the lists are not even asked for.
const account = useAtomValue(() => MembersAtoms.account);
const me = computed(() => (AsyncResult.isSuccess(account.value) ? account.value.value : undefined));
const isOwner = computed(() => me.value?.role === "owner");
const notice = computed(() =>
  me.value === undefined ? undefined : MembersAtoms.quotaNotice(me.value.ai),
);

const noMembers = Atom.make(AsyncResult.initial<ReadonlyArray<Members.Member>>());
const noInvites = Atom.make(AsyncResult.initial<ReadonlyArray<Invite.Invite>>());
const members = useAtomValue(() => (isOwner.value ? MembersAtoms.members : noMembers));
const invites = useAtomValue(() => (isOwner.value ? MembersAtoms.invites : noInvites));

const now = DateTime.nowUnsafe();
const people = computed(() => (AsyncResult.isSuccess(members.value) ? members.value.value : []));
const pending = computed(() =>
  AsyncResult.isSuccess(invites.value) ? MembersAtoms.openInvites(invites.value.value, now) : [],
);
const links = (count: number) => `${count} ${count === 1 ? "link" : "links"}`;

// Inviting: the link lives only in the `createInvite` result, which is reset on dismiss.
const [created, create] = useAtom(() => MembersAtoms.createInvite);
const creating = computed(() => created.value.waiting);
const createError = computed(() =>
  AsyncResult.isFailure(created.value) ? "Couldn't create the invite. Try again." : undefined,
);
const link = computed(() =>
  AsyncResult.isSuccess(created.value) && !created.value.waiting
    ? MembersAtoms.inviteLink(PageOrigin.pageOrigin(), created.value.value.token)
    : undefined,
);
const copy = useAtomSet(() => MembersAtoms.copyLink, { mode: "promiseExit" });
const copyState = ref<"idle" | "copied" | "failed">("idle");
const copyLink = async () => {
  if (link.value === undefined) return;
  copyState.value = Exit.isSuccess(await copy(link.value)) ? "copied" : "failed";
};
const dismissLink = () => {
  create(Atom.Reset);
  copyState.value = "idle";
};

// Removing a member and revoking an invite both ask first.
const remove = useAtomSet(() => MembersAtoms.removeMember, { mode: "promiseExit" });
const revoke = useAtomSet(() => MembersAtoms.revokeInvite, { mode: "promiseExit" });
type Asking =
  | { readonly kind: "member"; readonly member: Members.Member }
  | { readonly kind: "invite"; readonly invite: Invite.Invite };
const asking = ref<Asking>();
const busy = ref(false);
const failed = ref<string>();
const ask = (value: Asking) => {
  failed.value = undefined;
  asking.value = value;
};
const confirm = async () => {
  const value = asking.value;
  if (value === undefined) return;
  busy.value = true;
  const exit =
    value.kind === "member" ? await remove(value.member.id) : await revoke(value.invite.id);
  busy.value = false;
  if (Exit.isSuccess(exit)) asking.value = undefined;
  else {
    failed.value =
      value.kind === "member"
        ? "Couldn't remove the member. Nothing is lost by trying again."
        : "Couldn't revoke the invite. Try again.";
  }
};
const dialog = computed(() => {
  const value = asking.value;
  if (value === undefined) return undefined;
  return value.kind === "member"
    ? {
        title: `Remove ${value.member.displayName}?`,
        description: `Everything ${value.member.displayName} stored here is deleted for good: ${links(value.member.links)}, their open tabs, devices and tokens. They are signed out everywhere. This can't be undone.`,
        action: "Remove and delete data",
        pendingAction: "Removing…",
      }
    : {
        title: "Revoke invite?",
        description: "The link stops working. Someone who already joined with it stays.",
        action: "Revoke",
        pendingAction: "Revoking…",
      };
});
</script>

<template>
  <section v-if="notice" aria-label="AI summaries" class="flex flex-col gap-1">
    <SectionHeader title="AI summaries" />
    <ul>
      <ListRow as="li" data-test="ai-quota">
        <template #title
          ><ListRowTitle muted>{{ notice }}</ListRowTitle></template
        >
      </ListRow>
    </ul>
  </section>

  <section
    v-if="isOwner && AsyncResult.isSuccess(members) && AsyncResult.isSuccess(invites)"
    aria-label="Members"
    class="flex flex-col gap-1"
    data-test="members"
  >
    <SectionHeader title="Members" :count="people.length" />
    <p v-if="createError" role="alert" class="text-body text-destructive">{{ createError }}</p>
    <ul>
      <ListRow v-for="member in people" :key="member.id" as="li" data-test="member">
        <template #title>
          <ListRowTitle v-bind="{ 'data-test': 'member-name' }">{{
            member.displayName
          }}</ListRowTitle>
        </template>
        <template #meta>
          <span>{{ member.role === "owner" ? "Owner" : "Member" }}</span>
          <span>{{ links(member.links) }}</span>
          <span>joined {{ SettingsRows.formatDate(member.createdAt) }}</span>
        </template>
        <template v-if="member.role !== 'owner'" #trailing>
          <Button as-child variant="ghost" size="sm">
            <button
              type="button"
              data-test="remove-member"
              @click="ask({ kind: 'member', member })"
            >
              Remove
            </button>
          </Button>
        </template>
      </ListRow>
      <ListRow v-for="invite in pending" :key="invite.id" as="li" data-test="invite">
        <template #title><ListRowTitle>Invite link</ListRowTitle></template>
        <template #meta>
          <span>not used yet</span>
          <span>created {{ SettingsRows.formatDate(invite.createdAt) }}</span>
          <span>{{ MembersAtoms.formatExpiry(invite.expiresAt, now) }}</span>
        </template>
        <template #trailing>
          <Button as-child variant="ghost" size="sm">
            <button
              type="button"
              data-test="revoke-invite"
              @click="ask({ kind: 'invite', invite })"
            >
              Revoke
            </button>
          </Button>
        </template>
      </ListRow>
      <ListRow as="li">
        <template #title>
          <ListRowTitle>Invite someone</ListRowTitle>
        </template>
        <template #meta><span>a link that works once, for 7 days</span></template>
        <template #trailing>
          <Button as-child variant="ghost" size="sm">
            <button
              type="button"
              data-test="create-invite"
              :disabled="creating"
              @click="create(undefined)"
            >
              New invite link
            </button>
          </Button>
        </template>
      </ListRow>
    </ul>

    <InviteLinkDialog :link="link" :copy="copyState" @copy="copyLink" @dismiss="dismissLink" />
    <ConfirmDialog
      :open="dialog !== undefined"
      :title="dialog?.title ?? ''"
      :description="dialog?.description ?? ''"
      :action="dialog?.action ?? ''"
      :pending-action="dialog?.pendingAction ?? ''"
      :pending="busy"
      :error="failed"
      @confirm="confirm"
      @cancel="asking = undefined"
    />
  </section>
</template>
