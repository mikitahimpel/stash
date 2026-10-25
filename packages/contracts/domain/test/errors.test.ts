import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import * as Errors from "../src/errors.ts";

describe("tagged errors", () => {
  const cases = [
    ["NotFound", Errors.NotFound, { resource: "link", id: "link-1" }],
    ["Unauthorized", Errors.Unauthorized, { message: "Missing token" }],
    ["RateLimited", Errors.RateLimited, { retryAfterSeconds: 30 }],
    ["ValidationError", Errors.ValidationError, { message: "Invalid url" }],
    ["Conflict", Errors.Conflict, { message: "Already saved" }],
  ] as const;

  it.each(cases)("%s round-trips with its _tag", (tag, schema, fields) => {
    const encoded = { _tag: tag, ...fields };
    const decoded = Schema.decodeUnknownSync(schema as Schema.Codec<unknown, unknown>)(encoded);
    expect(decoded).toBeInstanceOf(schema);
    expect((decoded as { _tag: string })._tag).toBe(tag);
    expect(Schema.encodeUnknownSync(schema as Schema.Codec<unknown, unknown>)(decoded)).toEqual(
      encoded,
    );
  });

  it.each(cases)("%s rejects a wrong _tag", (_, schema, fields) => {
    expect(() =>
      Schema.decodeUnknownSync(schema as Schema.Codec<unknown, unknown>)({
        _tag: "Other",
        ...fields,
      }),
    ).toThrow();
  });

  it("rejects invalid fields", () => {
    expect(() =>
      Schema.decodeUnknownSync(Errors.RateLimited)({ _tag: "RateLimited", retryAfterSeconds: -1 }),
    ).toThrow();
    expect(() => Schema.decodeUnknownSync(Errors.NotFound)({ _tag: "NotFound" })).toThrow();
  });

  it.effect("errors are yieldable and caught by tag", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(new Errors.NotFound({ resource: "link", id: "link-1" }));
      expect(Exit.isFailure(exit)).toBe(true);
      const recovered = yield* new Errors.Conflict({ message: "Already saved" }).pipe(
        Effect.catchTag("Conflict", (e) => Effect.succeed(e.message)),
      );
      expect(recovered).toBe("Already saved");
    }),
  );
});
