import * as D1Database from "@stash/backend-platform/d1-database";
import * as Invite from "@stash/contracts-domain/invite";
import * as User from "@stash/contracts-domain/user";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// Started Google sign-ins in D1 (`google_flows`), one row per OAuth `state`, for 10 minutes. A
// flow is taken once, strictly: the callback takes it with one `DELETE ... RETURNING`. It holds the PKCE verifier and the nonce (never sent anywhere but to
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

export class GoogleFlowsStore extends Context.Service<
  GoogleFlowsStore,
  {
    readonly put: (state: string, flow: StoredGoogleFlow) => Effect.Effect<void>;
    /** The flow of `state`, once. */
    readonly take: (state: string) => Effect.Effect<Option.Option<StoredGoogleFlow>>;
  }
>()("@stash/backend-auth/GoogleFlowsStore") {}

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  return GoogleFlowsStore.of({
    put: (state, flow) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const json = yield* Schema.encodeEffect(Json)(flow);
        yield* db.batch([
          D1Database.sql`DELETE FROM google_flows WHERE expires_at <= ${now}`,
          D1Database.sql`INSERT INTO google_flows (state, flow, expires_at)
            VALUES (${state}, ${json}, ${now + ttlSeconds * 1000})`,
        ]);
      }).pipe(Effect.orDie),
    take: (state) =>
      Effect.gen(function* () {
        if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) return Option.none();
        const [row] = yield* db.all(
          D1Database.sql`DELETE FROM google_flows WHERE state = ${state} RETURNING flow, expires_at`,
        );
        if (row === undefined) return Option.none();
        if (Number(row["expires_at"]) <= (yield* Clock.currentTimeMillis)) return Option.none();
        return Option.some(yield* Schema.decodeEffect(Json)(String(row["flow"])));
      }).pipe(Effect.orDie),
  });
});

export const layer: Layer.Layer<GoogleFlowsStore, never, D1Database.Database> =
  Layer.effect(GoogleFlowsStore)(make);
