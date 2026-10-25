import { NodeFileSystem } from "@effect/platform-node";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import * as Device from "@stash/contracts-domain/device";
import { Effect, Option, Schema } from "effect";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as DeviceMap from "../src/device-map.ts";

const deviceId = Schema.decodeUnknownSync(Device.DeviceId);
const phone = "00000000-0000-4000-8000-000000000001";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stash-device-map-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const withMap = <A, E>(
  path: string,
  f: (map: DeviceMap.DeviceMap["Service"]) => Effect.Effect<A, E>,
) =>
  DeviceMap.DeviceMap.use(f).pipe(
    Effect.provide(DeviceMap.layer(path)),
    Effect.provide(NodeFileSystem.layer),
  );

describe("DeviceMap file layer", () => {
  it.effect("starts empty when the state file is missing", () =>
    Effect.gen(function* () {
      const found = yield* withMap(join(dir, "state.json"), (map) => map.get(phone));
      expect(Option.isNone(found)).toBe(true);
    }),
  );

  it.effect("persists mappings across restarts, creating the directory", () =>
    Effect.gen(function* () {
      const path = join(dir, "nested", "state.json");
      yield* withMap(path, (map) => map.set(phone, deviceId("stash-device-1")));
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
        devices: { [phone]: "stash-device-1" },
      });
      const found = yield* withMap(path, (map) => map.get(phone));
      expect(found).toEqual(Option.some("stash-device-1"));

      yield* withMap(path, (map) => map.remove(phone));
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ devices: {} });
    }),
  );

  it.effect("fails with DeviceMapError on a corrupt state file", () =>
    Effect.gen(function* () {
      const path = join(dir, "state.json");
      writeFileSync(path, "not json");
      const error = yield* Effect.flip(withMap(path, (map) => map.get(phone)));
      expect(error._tag).toBe("DeviceMapError");
    }),
  );

  it("defaults to Application Support", () => {
    expect(DeviceMap.defaultPath("/Users/someone")).toBe(
      "/Users/someone/Library/Application Support/stash-mac-agent/state.json",
    );
  });
});
