import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import * as ContentHttp from "../src/content-http.ts";
import * as FakeHttp from "./fake-http.ts";

const url = "https://example.com/page";

/** Runs `effect` while the test clock jumps far enough ahead for every timeout and retry delay. */
const withTime = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    yield* TestClock.adjust("10 minutes");
    return yield* Fiber.join(fiber);
  });

describe("ContentHttp.getText", () => {
  it.effect("returns the body, status and lowercased content type", () =>
    Effect.gen(function* () {
      const response = yield* ContentHttp.getText(url);
      expect(response).toEqual({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "hi",
      });
      const [request] = yield* FakeHttp.FakeHttp.use((http) => http.requests);
      expect(request?.headers["user-agent"]).toBe(ContentHttp.userAgent);
    }).pipe(
      Effect.provide(
        FakeHttp.layer({ [url]: { body: "hi", contentType: "Text/HTML; charset=utf-8" } }),
      ),
    ),
  );

  it.effect("retries transient failures and then succeeds", () =>
    Effect.gen(function* () {
      const response = yield* withTime(ContentHttp.getText(url));
      expect(response.body).toBe("third time");
      expect(yield* FakeHttp.FakeHttp.use((http) => http.requests)).toHaveLength(3);
    }).pipe(
      Effect.provide(
        FakeHttp.layer({
          [url]: (attempt) =>
            attempt === 1
              ? "transport-error"
              : attempt === 2
                ? { status: 503 }
                : { body: "third time" },
        }),
      ),
    ),
  );

  it.effect("gives up after the configured retries", () =>
    Effect.gen(function* () {
      const error = yield* withTime(ContentHttp.getText(url)).pipe(Effect.flip);
      expect(error.reason).toBe("Status");
      expect(error.status).toBe(429);
      expect(yield* FakeHttp.FakeHttp.use((http) => http.requests)).toHaveLength(
        ContentHttp.defaultPolicy.retries + 1,
      );
    }).pipe(Effect.provide(FakeHttp.layer({ [url]: { status: 429 } }))),
  );

  it.effect("does not retry a 404", () =>
    Effect.gen(function* () {
      const error = yield* ContentHttp.getText(url).pipe(Effect.flip);
      expect(error.reason).toBe("Status");
      expect(error.status).toBe(404);
      expect(error.isTransient).toBe(false);
      expect(yield* FakeHttp.FakeHttp.use((http) => http.requests)).toHaveLength(1);
    }).pipe(Effect.provide(FakeHttp.layer({ [url]: { status: 404 } }))),
  );

  it.effect("times out a hanging request on every attempt", () =>
    Effect.gen(function* () {
      const error = yield* withTime(ContentHttp.getText(url)).pipe(Effect.flip);
      expect(error.reason).toBe("Timeout");
      expect(yield* FakeHttp.FakeHttp.use((http) => http.requests)).toHaveLength(
        ContentHttp.defaultPolicy.retries + 1,
      );
    }).pipe(Effect.provide(FakeHttp.layer({ [url]: "hang" }))),
  );

  it.effect("follows an overridden policy", () =>
    Effect.gen(function* () {
      const error = yield* withTime(ContentHttp.getText(url)).pipe(Effect.flip);
      expect(error.reason).toBe("Transport");
      expect(yield* FakeHttp.FakeHttp.use((http) => http.requests)).toHaveLength(1);
    }).pipe(
      Effect.provideService(ContentHttp.FetchPolicy, { ...ContentHttp.defaultPolicy, retries: 0 }),
      Effect.provide(FakeHttp.layer({})),
    ),
  );
});
