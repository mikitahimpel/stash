import * as Kv from "@stash/backend-platform/kv";
import * as SignIn from "@stash/contracts-domain/sign-in";
import * as User from "@stash/contracts-domain/user";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The challenge of each WebAuthn ceremony, in KV until it is answered or 5 minutes pass. A
// challenge works once: taking it deletes it. What it is for is stored with it, so an answer to a
// sign-in challenge cannot add a passkey, and one made for an invite or a user serves only that
// invite or user.

export const Challenge = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("sign-in"), challenge: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("sign-up"),
    challenge: Schema.String,
    /** The id the new member gets: it is the WebAuthn user id in the passkey. */
    userId: User.UserId,
    /** The hash of the invite token it was made for. */
    inviteHash: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("add"), challenge: Schema.String, userId: User.UserId }),
]);
export type Challenge = typeof Challenge.Type;

const Json = Schema.fromJsonString(Challenge);

/** Seconds a challenge waits for its answer. The browser's own timeout is shorter. */
export const ttlSeconds = 300;

const key = (id: SignIn.ChallengeId) => `passkey-challenge:${id}`;

export class PasskeyChallenges extends Context.Service<
  PasskeyChallenges,
  {
    /** Stores a challenge and answers its new id. */
    readonly put: (challenge: Challenge) => Effect.Effect<SignIn.ChallengeId>;
    /** The challenge of `id`, once: it is deleted. `None` if unknown or expired. */
    readonly take: (id: SignIn.ChallengeId) => Effect.Effect<Option.Option<Challenge>>;
  }
>()("@stash/backend-auth/PasskeyChallenges") {}

export const make = Effect.gen(function* () {
  const kv = yield* Kv.Kv;
  return PasskeyChallenges.of({
    put: (challenge) =>
      Effect.gen(function* () {
        const id = SignIn.ChallengeId.make(
          Base64Url.encode(crypto.getRandomValues(new Uint8Array(24))),
        );
        yield* kv.put(key(id), yield* Schema.encodeEffect(Json)(challenge), {
          expirationTtl: ttlSeconds,
        });
        return id;
      }).pipe(Effect.orDie),
    take: (id) =>
      Effect.gen(function* () {
        const stored = yield* kv.get(key(id));
        if (Option.isNone(stored)) return Option.none();
        yield* kv.delete(key(id));
        return Option.some(yield* Schema.decodeEffect(Json)(stored.value));
      }).pipe(Effect.orDie),
  });
});

/** The store over the KV namespace. */
export const layer: Layer.Layer<PasskeyChallenges, never, Kv.Kv> =
  Layer.effect(PasskeyChallenges)(make);
