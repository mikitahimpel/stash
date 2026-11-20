import * as Kv from "@stash/backend-platform/kv";
import * as Invite from "@stash/contracts-domain/invite";
import * as User from "@stash/contracts-domain/user";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// Started Google sign-ins in KV, one key per OAuth `state`, for 10 minutes. A flow is taken once:
// the callback deletes it. It holds the PKCE verifier and the nonce (never sent anywhere but to
// Google's token endpoint), the hash of the cookie that binds it to the browser that started it,
// and what the sign-in is for.

export const StoredGoogleFlow = Schema.Struct({
  verifier: Schema.String,
  nonce: Schema.String,
  /** SHA-256 of the binding cookie's value. */
  bindingHash: Schema.String,
  /** Where to go once signed in (a sanitized path). */
  redirect: Schema.String,
  invite: Schema.optionalKey(Invite.InviteToken),
  /** Set when a signed-in user links their Google account instead of signing in. */
  linkUserId: Schema.optionalKey(User.UserId),
});
export type StoredGoogleFlow = typeof StoredGoogleFlow.Type;

const Json = Schema.fromJsonString(StoredGoogleFlow);

export const ttlSeconds = 600;

const key = (state: string) => `google-flow:${state}`;

export class GoogleFlowsStore extends Context.Service<
  GoogleFlowsStore,
  {
    readonly put: (state: string, flow: StoredGoogleFlow) => Effect.Effect<void>;
    /** The flow of `state`, once. */
    readonly take: (state: string) => Effect.Effect<Option.Option<StoredGoogleFlow>>;
  }
>()("@stash/backend-auth/GoogleFlowsStore") {}

export const make = Effect.gen(function* () {
  const kv = yield* Kv.Kv;
  return GoogleFlowsStore.of({
    put: (state, flow) =>
      Effect.gen(function* () {
        yield* kv.put(key(state), yield* Schema.encodeEffect(Json)(flow), {
          expirationTtl: ttlSeconds,
        });
      }).pipe(Effect.orDie),
    take: (state) =>
      Effect.gen(function* () {
        if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) return Option.none();
        const stored = yield* kv.get(key(state));
        if (Option.isNone(stored)) return Option.none();
        yield* kv.delete(key(state));
        return Option.some(yield* Schema.decodeEffect(Json)(stored.value));
      }).pipe(Effect.orDie),
  });
});

export const layer: Layer.Layer<GoogleFlowsStore, never, Kv.Kv> =
  Layer.effect(GoogleFlowsStore)(make);
