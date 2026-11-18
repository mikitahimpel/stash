import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { routes } from "../src/routes.ts";

const page = { render: () => null };

const router = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/settings", name: "settings", component: page }, ...routes],
  });

describe("connect routes", () => {
  it.each([
    ["/connect", "/settings#connections"],
    ["/connect?guide=iphone", "/settings?guide=iphone#connections"],
    ["/connect?guide=extension", "/settings?guide=extension#connections"],
  ])("takes %s to the section of Settings, with its guide", async (from, to) => {
    const app = router();
    await app.push(from);
    expect(app.currentRoute.value.fullPath).toBe(to);
  });

  it("keeps the extension's approve page at /connect/extension, with its code", () => {
    const resolved = router().resolve("/connect/extension?code=abc");
    expect(resolved.name).toBe("connect-extension");
    expect(resolved.query).toEqual({ code: "abc" });
  });
});
