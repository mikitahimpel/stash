import { describe, expect, it } from "@effect/vitest";
import { OpenApi } from "effect/http-api";
import * as InternalApi from "../src/internal-api.ts";
import * as Api from "../src/stash-api.ts";
import * as Security from "../src/security.ts";

interface EndpointShape {
  readonly method: string;
  readonly path: string;
  readonly middlewares: ReadonlySet<unknown>;
}
const groups = InternalApi.InternalApi.groups as unknown as Record<
  string,
  { readonly endpoints: Record<string, EndpointShape> }
>;

describe("InternalApi", () => {
  it("has only internal.createMcpToken at POST /internal/mcp-tokens", () => {
    expect(Object.keys(groups)).toEqual(["internal"]);
    const endpoints = groups["internal"]!.endpoints;
    expect(Object.keys(endpoints)).toEqual(["createMcpToken"]);
    expect(endpoints["createMcpToken"]!.method).toBe("POST");
    expect(endpoints["createMcpToken"]!.path).toBe("/internal/mcp-tokens");
  });

  it("has no Authorization middleware: only the binding entrypoint serves it", () => {
    expect(
      groups["internal"]!.endpoints["createMcpToken"]!.middlewares.has(Security.Authorization),
    ).toBe(false);
  });

  it("responds with 201 or 403", () => {
    const spec = OpenApi.fromApi(InternalApi.InternalApi);
    const operation = (spec.paths as Record<string, Record<string, { responses: object }>>)[
      "/internal/mcp-tokens"
    ]?.["post"];
    expect(
      Object.keys(operation?.responses ?? {})
        .filter((s) => s !== "400")
        .sort(),
    ).toEqual(["201", "403"]);
  });

  it("is not part of the public StashApi", () => {
    const spec = OpenApi.fromApi(Api.StashApi);
    expect(Object.keys(spec.paths).some((path) => path.startsWith("/internal"))).toBe(false);
  });
});
