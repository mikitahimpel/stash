import * as D1Database from "@stash/backend-platform/d1-database";
import * as SignIn from "@stash/contracts-domain/sign-in";
import * as User from "@stash/contracts-domain/user";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The challenge of each WebAuthn ceremony, in D1 (`passkey_challenges`) until it is answered or 5
// minutes pass. A challenge works once, strictly: taking it is one `DELETE ... RETURNING`, so two
// answers racing for it, from anywhere, get it at most once. What it is for is stored with it, so an answer to a
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
  const db = yield* D1Database.Database;
  return PasskeyChallenges.of({
    put: (challenge) =>
      Effect.gen(function* () {
        const id = SignIn.ChallengeId.make(
          Base64Url.encode(crypto.getRandomValues(new Uint8Array(24))),
        );
        const now = yield* Clock.currentTimeMillis;
        const json = yield* Schema.encodeEffect(Json)(challenge);
        yield* db.batch([
          D1Database.sql`DELETE FROM passkey_challenges WHERE expires_at <= ${now}`,
          D1Database.sql`INSERT INTO passkey_challenges (id, challenge, expires_at)
            VALUES (${id}, ${json}, ${now + ttlSeconds * 1000})`,
        ]);
        return id;
      }).pipe(Effect.orDie),
    take: (id) =>
      Effect.gen(function* () {
        const [row] = yield* db.all(
          D1Database.sql`DELETE FROM passkey_challenges WHERE id = ${id}
            RETURNING challenge, expires_at`,
        );
        if (row === undefined) return Option.none();
        if (Number(row["expires_at"]) <= (yield* Clock.currentTimeMillis)) return Option.none();
        return Option.some(yield* Schema.decodeEffect(Json)(String(row["challenge"])));
      }).pipe(Effect.orDie),
  });
});

/** The store over D1. */
export const layer: Layer.Layer<PasskeyChallenges, never, D1Database.Database> =
  Layer.effect(PasskeyChallenges)(make);
