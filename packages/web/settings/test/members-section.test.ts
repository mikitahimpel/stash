import * as AtomVue from "@effect/atom-vue";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as ApiTesting from "@stash/web-api-client/testing";
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, describe, expect, it } from "vitest";
import * as MembersAtoms from "../src/members/members-atoms.ts";
import MembersSection from "../src/members/members-section.vue";
import * as SettingsAtoms from "../src/settings-atoms.ts";

enableAutoUnmount(afterEach);

let registry: AtomRegistry.AtomRegistry | undefined;
afterEach(() => {
  registry?.dispose();
  registry = undefined;
});

let page: DOMWrapper<HTMLElement> | undefined;
/** Dialogs teleport to <body>, outside the wrapper, so tests query the whole page. */
const body = (): DOMWrapper<HTMLElement> => page!;

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const click = async (selector: string) => {
  await body().find(selector).trigger("click");
  await settle();
};

const ai = { dailyQuota: null, usedToday: 0, waiting: 0, resetsAt: "2026-01-03T00:00:00.000Z" };
const user = (id: string, displayName: string, role: "owner" | "member") => ({
  id,
  displayName,
  role,
  createdAt: "2026-01-01T00:00:00.000Z",
  dailyAiQuota: role === "owner" ? null : 200,
});
const inWeek = DateTime.formatIso(DateTime.add(DateTime.nowUnsafe(), { days: 6, hours: 2 }));
const invite = (id: string, change: Record<string, unknown> = {}) => ({
  id,
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: inWeek,
  revokedAt: null,
  acceptedAt: null,
  acceptedBy: null,
  ...change,
});
const token = "t".repeat(43);

const mountSection = async (
  options: {
    readonly me?: Record<string, unknown>;
    readonly removeStatus?: number;
  } = {},
) => {
  const calls: Array<string> = [];
  const copied: Array<string> = [];
  let members = [
    { ...user("owner", "Synthetic owner", "owner"), links: 12 },
    { ...user("user-1", "Synthetic member", "member"), links: 1 },
  ];
  let invites = [
    invite("invite-open"),
    invite("invite-used", { acceptedAt: "2026-01-02T00:00:00.000Z", acceptedBy: "user-1" }),
    invite("invite-revoked", { revokedAt: "2026-01-02T00:00:00.000Z" }),
    invite("invite-expired", { expiresAt: "2026-01-02T00:00:00.000Z" }),
  ];
  registry = ApiTesting.makeRegistry(
    {
      "GET /members/me": () => {
        calls.push("me");
        return ApiTesting.json(options.me ?? { ...user("owner", "Synthetic owner", "owner"), ai });
      },
      "GET /members": () => {
        calls.push("members");
        return ApiTesting.json(members);
      },
      "GET /invites": () => {
        calls.push("invites");
        return ApiTesting.json(invites);
      },
      "POST /invites": () => {
        calls.push("create invite");
        invites = [...invites, invite("invite-new")];
        return ApiTesting.json({ ...invite("invite-new"), token }, 201);
      },
      "DELETE /invites/:id": (_, { id }) => {
        calls.push(`revoke ${id}`);
        invites = invites.filter((entry) => entry.id !== id);
        return new Response(null, { status: 204 });
      },
      "DELETE /members/:id": (_, { id }) => {
        calls.push(`remove ${id}`);
        if (options.removeStatus !== undefined) {
          return ApiTesting.json({ _tag: "Conflict", message: "busy" }, options.removeStatus);
        }
        members = members.filter((entry) => entry.id !== id);
        return new Response(null, { status: 204 });
      },
    },
    {
      initialValues: [
        [
          SettingsAtoms.clipboard,
          Layer.succeed(Clipboard.Clipboard)(
            Clipboard.make({
              read: Effect.succeed([]),
              readString: Effect.succeed(""),
              write: () => Effect.void,
              writeString: (text) => Effect.sync(() => void copied.push(text)),
            }),
          ),
        ],
      ],
    },
  );
  const wrapper = mount(MembersSection, {
    attachTo: "body",
    global: { provide: { [AtomVue.registryKey]: registry } },
  });
  page = new DOMWrapper(wrapper.element.ownerDocument.body);
  await settle();
  return { wrapper, calls, copied };
};

describe("Settings → Members", () => {
  it("shows the owner everyone here, and the invites that still work", async () => {
    await mountSection();
    const rows = body().findAll("[data-test=member]");
    expect(rows.map((row) => row.find("[data-test=member-name]").text())).toEqual([
      "Synthetic owner",
      "Synthetic member",
    ]);
    expect(rows[0]!.text()).toContain("Owner");
    expect(rows[0]!.text()).toContain("12 links");
    expect(rows[1]!.text()).toContain("1 link");
    // The owner cannot be removed; a member can.
    expect(rows[0]!.find("[data-test=remove-member]").exists()).toBe(false);
    expect(rows[1]!.find("[data-test=remove-member]").exists()).toBe(true);
    // Used, revoked and expired invites are not listed.
    const invites = body().findAll("[data-test=invite]");
    expect(invites).toHaveLength(1);
    expect(invites[0]!.text()).toContain("expires in 6 days");
  });

  it("removes a member only after a confirmation that says their data is deleted", async () => {
    const { calls } = await mountSection();
    await click("[data-test=remove-member]");
    expect(calls).not.toContain("remove user-1");
    const description = body().find("[data-test=confirm-description]").text();
    expect(description).toContain("Synthetic member");
    expect(description).toContain("deleted for good");
    expect(description).toContain("1 link");
    expect(description).toContain("can't be undone");

    await click("[data-test=cancel]");
    expect(calls).not.toContain("remove user-1");
    expect(body().findAll("[data-test=member]")).toHaveLength(2);

    await click("[data-test=remove-member]");
    await click("[data-test=confirm]");
    expect(calls).toContain("remove user-1");
    expect(body().findAll("[data-test=member]")).toHaveLength(1);
    expect(body().find("[data-test=confirm]").exists()).toBe(false);
  });

  it("keeps the dialog open and says so when removing fails", async () => {
    await mountSection({ removeStatus: 409 });
    await click("[data-test=remove-member]");
    await click("[data-test=confirm]");
    expect(body().find("[role=alert]").text()).toContain("Couldn't remove");
    expect(body().findAll("[data-test=member]")).toHaveLength(2);
  });

  it("creates an invite link, shows it once to copy, and lists the invite", async () => {
    const { calls, copied } = await mountSection();
    await click("[data-test=create-invite]");
    expect(calls).toContain("create invite");
    const field = body().find<HTMLInputElement>("[data-test=invite-link]");
    const link = field.element.value;
    expect(link.endsWith(`/invite/${token}`)).toBe(true);
    expect(body().find("[data-test=invite-warning]").text()).toContain("works once");

    await click("[data-test=copy-invite]");
    expect(copied).toEqual([link]);
    expect(body().find("[data-test=copy-invite]").text()).toBe("Copied");

    await click("[data-test=dismiss-invite]");
    expect(body().find("[data-test=invite-link]").exists()).toBe(false);
    expect(body().text()).not.toContain(token);
    expect(body().findAll("[data-test=invite]")).toHaveLength(2);
  });

  it("revokes an invite after a confirmation", async () => {
    const { calls } = await mountSection();
    await click("[data-test=revoke-invite]");
    expect(calls).not.toContain("revoke invite-open");
    await click("[data-test=confirm]");
    expect(calls).toContain("revoke invite-open");
    expect(body().findAll("[data-test=invite]")).toHaveLength(0);
  });

  it("shows a member no Members section, and never asks for the lists", async () => {
    const { calls } = await mountSection({
      me: { ...user("user-1", "Synthetic member", "member"), ai: { ...ai, dailyQuota: 200 } },
    });
    expect(body().find("[data-test=members]").exists()).toBe(false);
    expect(body().find("[data-test=create-invite]").exists()).toBe(false);
    expect(calls).toEqual(["me"]);
  });
});

describe("the AI summaries line", () => {
  const member = (usage: Record<string, unknown>) => ({
    ...user("user-1", "Synthetic member", "member"),
    ai: { ...ai, dailyQuota: 200, ...usage },
  });

  it("says quietly that links over today's cap are saved and summarized tomorrow", async () => {
    await mountSection({ me: member({ usedToday: 200, waiting: 3 }) });
    const line = body().find("[data-test=ai-quota]");
    expect(line.text()).toBe(
      "200 of 200 links summarized today · 3 more are saved and will be summarized tomorrow",
    );
    // A note, not an error.
    expect(body().find("[role=alert]").exists()).toBe(false);
  });

  it("shows the count for a member under the cap", async () => {
    await mountSection({ me: member({ usedToday: 12 }) });
    expect(body().find("[data-test=ai-quota]").text()).toBe("12 of 200 links summarized today");
  });

  it("shows the owner, who has no cap, no line", async () => {
    await mountSection();
    expect(body().find("[data-test=ai-quota]").exists()).toBe(false);
  });

  it("words the notice for each case", () => {
    const usage = (dailyQuota: number | null, usedToday: number, waiting: number) =>
      MembersAtoms.quotaNotice({
        dailyQuota,
        usedToday,
        waiting,
        resetsAt: DateTime.makeUnsafe("2026-01-03T00:00:00.000Z"),
      });
    expect(usage(null, 500, 0)).toBeUndefined();
    expect(usage(200, 0, 0)).toBe("0 of 200 links summarized today");
    expect(usage(200, 200, 0)).toBe(
      "200 of 200 links summarized today · links saved now are summarized tomorrow",
    );
    expect(usage(200, 200, 1)).toBe(
      "200 of 200 links summarized today · 1 more is saved and will be summarized tomorrow",
    );
    // A cap lowered during the day never reads "250 of 200".
    expect(usage(200, 250, 0)).toContain("200 of 200");
  });

  it("words an invite's expiry", () => {
    const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
    const at = (iso: string) => MembersAtoms.formatExpiry(DateTime.makeUnsafe(iso), now);
    expect(at("2026-01-08T00:00:00.000Z")).toBe("expires in 7 days");
    expect(at("2026-01-02T12:00:00.000Z")).toBe("expires in 1 day");
    expect(at("2026-01-01T05:30:00.000Z")).toBe("expires in 5 hours");
    expect(at("2026-01-01T00:20:00.000Z")).toBe("expires in under an hour");
  });
});
