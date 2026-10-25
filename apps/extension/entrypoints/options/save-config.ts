import type * as Security from "@stash/contracts-api/security";
import * as ExtensionConfig from "@stash/ext-platform/extension-config";
import * as StashApiClient from "@stash/ext-platform/stash-api-client";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

/** What the options form submits. */
export interface Input {
  readonly apiBaseUrl: string;
  readonly deviceToken: string;
}

/** The outcome shown on the options page. */
export type Result =
  | { readonly _tag: "Saved"; readonly principal: Security.Principal }
  | { readonly _tag: "Failed"; readonly message: string };

/** The saved API URL to prefill the form. The token is never read back into the page. */
export const load: Effect.Effect<string, never, ExtensionConfig.ExtensionConfig> = Effect.flatMap(
  ExtensionConfig.ExtensionConfig,
  (config) => config.get,
).pipe(
  Effect.map((config) => config.apiBaseUrl.toString()),
  Effect.orElseSucceed(() => ""),
);

/**
 * Saves the config and checks it with `GET /auth/me`. If the API rejects it, the previous config
 * is restored (or the config cleared when there was none), so a typo never replaces a working one.
 */
export const save = Effect.fnUntraced(function* (input: Input) {
  const config = yield* ExtensionConfig.ExtensionConfig;
  const client = yield* StashApiClient.StashApiClient;
  const previous = yield* config.get.pipe(
    Effect.map(Option.some),
    Effect.catchTag("ConfigError", () => Effect.succeed(Option.none())),
  );
  yield* config.set({
    apiBaseUrl: input.apiBaseUrl,
    deviceToken: Redacted.make(input.deviceToken),
  });
  return yield* client.auth.me().pipe(
    Effect.tapError(() =>
      Option.match(previous, {
        onNone: () => config.clear,
        onSome: (it) =>
          config.set({ apiBaseUrl: it.apiBaseUrl.toString(), deviceToken: it.deviceToken }),
      }).pipe(Effect.ignore),
    ),
  );
});

const message = (error: Effect.Error<ReturnType<typeof save>>): string => {
  switch (error._tag) {
    case "ConfigError":
      return "Enter an http(s) API URL and a device token.";
    case "Unauthorized":
      return "The API rejected this device token.";
    case "BrowserError":
      return "Could not access extension storage.";
    default:
      return "Could not reach the API at this URL.";
  }
};

/** `save`, with every failure turned into a message for the page. */
export const submit = (input: Input) =>
  save(input).pipe(
    Effect.match({
      onFailure: (error): Result => ({ _tag: "Failed", message: message(error) }),
      onSuccess: (principal): Result => ({ _tag: "Saved", principal }),
    }),
  );
