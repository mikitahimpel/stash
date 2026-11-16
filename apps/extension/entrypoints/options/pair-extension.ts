import * as Pairing from "@stash/contracts-domain/pairing";
import * as Tabs from "@stash/ext-platform/browser-tabs";
import * as ExtensionConfig from "@stash/ext-platform/extension-config";
import * as StashApiClient from "@stash/ext-platform/stash-api-client";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Schedule from "effect/Schedule";

// Pairing without copying a token (see `pairings` in `@stash/contracts-api`): the options page
// makes a one-time code, opens the web app's `/connect/extension?code=…` in a tab, where the
// signed-in owner approves this browser, and polls `pairings.claim` with the code until the api
// hands over the device token. The api is same-origin under `/api` of the web app.

/** How often the page asks whether the owner approved yet. */
export const pollInterval = Duration.seconds(2);

/** How long the page waits for the approval: the time to sign in, plus the claim window. */
export const waitAtMost = Duration.minutes(Pairing.pairingTtlMinutes + 5);

/** The outcome shown on the options page. */
export type Result =
  | { readonly _tag: "Connected"; readonly webOrigin: string }
  | { readonly _tag: "Failed"; readonly message: string };

/** The web app's origin from what the user typed (`stash.example.com`, a full URL, …). */
export const webOrigin = (input: string): string | undefined => {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

/** The web origin of a saved api base URL (`https://stash.example.com/api`), to prefill the field. */
export const webOriginOfApi = (apiBaseUrl: string): string =>
  apiBaseUrl === "" ? "" : (webOrigin(apiBaseUrl.replace(/\/api\/?$/, "")) ?? "");

/** 32 random bytes as base64url: 43 characters, a valid `PairingCode`. */
export const generateCode: Effect.Effect<Pairing.PairingCode> = Effect.sync(() =>
  Pairing.PairingCode.make(Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)))),
);

/**
 * A short check value of the code: its first four characters. The approve page shows the same,
 * so the owner can tell this request from one another page started. The web app keeps its own
 * copy of this rule (contexts share no logic).
 */
export const checkValue = (code: Pairing.PairingCode): string => code.slice(0, 4);

/** The page the owner approves on. */
export const approveUrl = (origin: string, code: Pairing.PairingCode): string =>
  `${origin}/connect/extension?code=${encodeURIComponent(code)}`;

class InvalidOrigin {
  readonly _tag = "InvalidOrigin";
}

/**
 * Opens the approval page, waits for the token and saves the config. `onCheck` gets the code's
 * check value as soon as the page opens, for the options page to show.
 */
export const pair = Effect.fnUntraced(function* (
  input: string,
  onCheck: (check: string) => void = () => {},
) {
  const origin = webOrigin(input);
  if (origin === undefined) return yield* Effect.fail(new InvalidOrigin());
  const code = yield* generateCode;
  onCheck(checkValue(code));
  const tabs = yield* Tabs.Tabs;
  yield* tabs.open(approveUrl(origin, code));
  const apiBaseUrl = `${origin}/api`;
  const client = yield* StashApiClient.anonymous(apiBaseUrl);
  const created = yield* client.pairings.claim({ payload: { code } }).pipe(
    Effect.retry({
      while: (error) => error._tag === "NotFound",
      schedule: Schedule.spaced(pollInterval),
    }),
    Effect.timeout(waitAtMost),
  );
  const config = yield* ExtensionConfig.ExtensionConfig;
  yield* config.set({ apiBaseUrl, deviceToken: created.token });
  return origin;
});

const message = (error: Effect.Error<ReturnType<typeof pair>>): string => {
  switch (error._tag) {
    case "InvalidOrigin":
      return "Enter the address of your Stash, for example https://stash.example.com.";
    case "TimeoutError":
    case "NotFound":
      return "Not approved in time. Click Connect to try again.";
    case "ConfigError":
    case "BrowserError":
      return "Could not save the connection in the extension's storage.";
    default:
      return "Could not reach Stash at this address.";
  }
};

/** `pair`, with every failure turned into a message for the page. */
export const connect = (input: string, onCheck?: (check: string) => void) =>
  pair(input, onCheck).pipe(
    Effect.match({
      onFailure: (error): Result => ({ _tag: "Failed", message: message(error) }),
      onSuccess: (origin): Result => ({ _tag: "Connected", webOrigin: origin }),
    }),
  );
