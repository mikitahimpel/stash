import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as PageNavigation from "@stash/web-platform/page-navigation";
import * as WebTesting from "@stash/web-platform/testing";
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import * as SecurityAtoms from "../src/security/security-atoms.ts";
import SecuritySection from "../src/security/security-section.vue";

vi.mock("@stash/web-platform/page-navigation", () => ({ navigateTo: vi.fn() }));

enableAutoUnmount(afterEach);
let registry: AtomRegistry.AtomRegistry | undefined;
afterEach(() => {
  registry?.dispose();
  registry = undefined;
  vi.mocked(PageNavigation.navigateTo).mockClear();
});

let page: DOMWrapper<HTMLElement> | undefined;
const body = (): DOMWrapper<HTMLElement> => page!;
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
const click = async (selector: string) => {
  await body().find(selector).trigger("click");
  await settle();
};

const passkey = (id: string, name: string) => ({
  id: id.padEnd(22, "x"),
  name,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
  synced: true,
});
const google = {
  id: "google:synthetic-sub",
  provider: "google",
  label: "person@example.com",
  linkedAt: "2026-01-02T00:00:00.000Z",
  fixed: false,
};
const challenge = { challengeId: "c".repeat(24), options: { challenge: "synthetic" } };
const credential = {
  id: "n".repeat(22),
  rawId: "n".repeat(22),
  type: "public-key",
  response: {},
  clientExtensionResults: {},
};

const mountSection = async (
  options: {
    readonly passkeys?: ReadonlyArray<ReturnType<typeof passkey>>;
    readonly accounts?: ReadonlyArray<typeof google>;
    readonly google?: boolean;
    readonly path?: string;
  } = {},
) => {
  const calls: Array<string> = [];
  let passkeys = [...(options.passkeys ?? [passkey("phone", "Synced passkey")])];
  let accounts = [...(options.accounts ?? [])];
  registry = ApiTesting.makeRegistry(
    {
      "GET /auth/methods": () =>
        ApiTesting.json({
          passkeys,
          accounts,
          providers: { google: options.google ?? true, github: true },
        }),
      "POST /auth/passkeys/options": () => {
        calls.push("add options");
        return ApiTesting.json(challenge);
      },
      "POST /auth/passkeys": () => {
        calls.push("add");
        const added = passkey("laptop", "Passkey");
        passkeys = [...passkeys, added];
        return ApiTesting.json(added, 201);
      },
      "DELETE /auth/passkeys/:id": (_, { id }) => {
        calls.push(`remove ${id}`);
        passkeys = passkeys.filter((p) => p.id !== id);
        return new Response(null, { status: 204 });
      },
      "DELETE /auth/accounts/:id": (_, { id }) => {
        calls.push(`unlink ${id}`);
        accounts = accounts.filter((a) => a.id !== id);
        return new Response(null, { status: 204 });
      },
      "POST /auth/google/link": () => {
        calls.push("link google");
        return ApiTesting.json({ url: "https://accounts.example.com/o/oauth2/auth?state=s" });
      },
    },
    {
      initialValues: [
        [
          SecurityAtoms.passkeys,
          WebTesting.layerPasskeys({ create: async () => credential, get: async () => credential }),
        ],
      ],
    },
  );
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/settings", component: { template: "<div />" } }],
  });
  await router.push(options.path ?? "/settings");
  const wrapper = mount(SecuritySection, {
    attachTo: "body",
    global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
  });
  page = new DOMWrapper(wrapper.element.ownerDocument.body);
  await settle();
  return { wrapper, calls };
};

describe("Settings → Security", () => {
  it("lists passkeys and linked accounts, and never lets the last way in go", async () => {
    await mountSection();
    expect(body().findAll("[data-test=passkey]")).toHaveLength(1);
    expect(body().find("[data-test=remove-passkey]").attributes("disabled")).toBeDefined();
  });

  it("adds a passkey on this device, and then either may be removed", async () => {
    const { calls } = await mountSection();
    await click("[data-test=add-passkey]");
    expect(calls).toEqual(["add options", "add"]);
    expect(body().findAll("[data-test=passkey]")).toHaveLength(2);
    const removes = body().findAll("[data-test=remove-passkey]");
    expect(removes[0]!.attributes("disabled")).toBeUndefined();
    await removes[0]!.trigger("click");
    await settle();
    await click("[data-test=confirm]");
    expect(calls.at(-1)).toBe(`remove ${"phone".padEnd(22, "x")}`);
    expect(body().findAll("[data-test=passkey]")).toHaveLength(1);
  });

  it("unlinks Google once there is another way in", async () => {
    const { calls } = await mountSection({ accounts: [google] });
    expect(body().find("[data-test=account]").text()).toContain("person@example.com");
    expect(body().find("[data-test=link-google]").exists()).toBe(false);
    await click("[data-test=remove-account]");
    await click("[data-test=confirm]");
    expect(calls).toEqual(["unlink google:synthetic-sub"]);
    expect(body().find("[data-test=link-google]").exists()).toBe(true);
  });

  it("links Google by leaving for Google's page", async () => {
    const { calls } = await mountSection();
    await click("[data-test=link-google]");
    expect(calls).toEqual(["link google"]);
    expect(PageNavigation.navigateTo).toHaveBeenCalledWith(
      "https://accounts.example.com/o/oauth2/auth?state=s",
    );
  });

  it("offers no Google where it is not configured", async () => {
    await mountSection({ google: false });
    expect(body().find("[data-test=link-google]").exists()).toBe(false);
    expect(body().find("[data-test=link-github]").exists()).toBe(true);
  });

  it("says why Google was not linked", async () => {
    await mountSection({ path: "/settings?signin=google_taken" });
    expect(body().find("[role=alert]").text()).toContain("already signs in another member");
  });
});
