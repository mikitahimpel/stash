import type * as AuthGroup from "@stash/contracts-api/auth";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Redacted from "effect/Redacted";
import * as DeviceFlowsStore from "./device-flows-store.ts";
import * as GithubClient from "./github-client.ts";

/** A fresh random flow id. It only names the flow; GitHub's `device_code` stays in KV. */
const generateFlowId: Effect.Effect<AuthGroup.DeviceFlowId> = Effect.sync(
  () => Base64Url.encode(crypto.getRandomValues(new Uint8Array(32))) as AuthGroup.DeviceFlowId,
);

/** Starts a GitHub device flow and keeps its `device_code` in KV under a new `flowId`. */
export const startDeviceFlow = Effect.fn("startDeviceFlow")(function* () {
  const github = yield* GithubClient.GithubClient;
  const store = yield* DeviceFlowsStore.DeviceFlowsStore;
  const code = yield* github.requestDeviceCode;
  const flowId = yield* generateFlowId;
  const now = yield* DateTime.now;
  yield* store.put(flowId, {
    deviceCode: Redacted.value(code.deviceCode),
    interval: code.interval,
    expiresAt: DateTime.addDuration(now, Duration.seconds(code.expiresIn)),
    nextPollAt: DateTime.addDuration(now, Duration.seconds(code.interval)),
  });
  return {
    flowId,
    userCode: code.userCode,
    verificationUri: code.verificationUri,
    expiresIn: code.expiresIn,
    interval: code.interval,
  } satisfies AuthGroup.DeviceFlowStarted;
});
