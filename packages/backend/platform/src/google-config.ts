import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

// Sign in with Google (#178): an OAuth 2.0 web client. `GOOGLE_CLIENT_ID` is a plain Worker var
// and `GOOGLE_CLIENT_SECRET` a secret, both from env. A deployment without them has no Google
// sign-in: the button is hidden and the routes answer 503.

/** Where the OpenID provider answers. Google's, unless a test points them at a fake one. */
export interface Endpoints {
  /** The `iss` its ID tokens carry. */
  readonly issuer: string;
  readonly authorization: string;
  readonly token: string;
  readonly jwks: string;
}

/** Google's published endpoints (https://accounts.google.com/.well-known/openid-configuration). */
export const googleEndpoints: Endpoints = {
  issuer: "https://accounts.google.com",
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
};

/** Google also signs ID tokens with this spelling of its issuer. */
export const googleIssuerAliases: ReadonlyArray<string> = ["accounts.google.com"];

/** The endpoints of a fake provider at `origin`, for local runs and browser tests. */
export const fakeEndpoints = (origin: string): Endpoints => ({
  issuer: origin,
  authorization: `${origin}/authorize`,
  token: `${origin}/token`,
  jwks: `${origin}/jwks`,
});

export type Config =
  | { readonly configured: false }
  | {
      readonly configured: true;
      readonly clientId: string;
      readonly clientSecret: Redacted.Redacted<string>;
      readonly endpoints: Endpoints;
    };

export class GoogleConfig extends Context.Service<GoogleConfig, Config>()(
  "@stash/backend-platform/GoogleConfig",
) {}

export class GoogleConfigError extends Data.TaggedError("GoogleConfigError")<{
  readonly cause: unknown;
}> {}

const Optional = Schema.optional(Schema.String);

/** The Worker vars this config reads. */
export const Env = Schema.Struct({
  GOOGLE_CLIENT_ID: Optional,
  GOOGLE_CLIENT_SECRET: Optional,
  /**
   * Only for `alchemy dev`: the origin of a fake OpenID provider (`/authorize`, `/token`,
   * `/jwks`), which the sign-in walk starts. Never set on a deploy.
   */
  GOOGLE_FAKE_IDP: Optional,
});
export type Env = typeof Env.Encoded;

const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

/** Reads the config from the Worker `env`. Google is off unless both the id and the secret are set. */
export const fromEnv = (env: unknown): Effect.Effect<Config, GoogleConfigError> =>
  Schema.decodeUnknownEffect(Env)(env).pipe(
    Effect.map((vars): Config => {
      if (!present(vars.GOOGLE_CLIENT_ID) || !present(vars.GOOGLE_CLIENT_SECRET)) {
        return { configured: false };
      }
      return {
        configured: true,
        clientId: vars.GOOGLE_CLIENT_ID,
        clientSecret: Redacted.make(vars.GOOGLE_CLIENT_SECRET),
        endpoints: present(vars.GOOGLE_FAKE_IDP)
          ? fakeEndpoints(new URL(vars.GOOGLE_FAKE_IDP).origin)
          : googleEndpoints,
      };
    }),
    Effect.mapError((cause) => new GoogleConfigError({ cause })),
  );

export const layerFromEnv = (env: unknown): Layer.Layer<GoogleConfig, GoogleConfigError> =>
  Layer.effect(GoogleConfig)(fromEnv(env));

/** Whether `env` turns Google on, for the Worker's 503 before the api runs. */
export const isConfigured = (env: Partial<Env>): boolean =>
  present(env.GOOGLE_CLIENT_ID) && present(env.GOOGLE_CLIENT_SECRET);
