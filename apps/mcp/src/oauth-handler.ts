import {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Effect, Layer } from "effect";
import * as Security from "@stash/contracts-api/security";
import * as Pages from "./authorize-pages.ts";
import * as DeviceFlowStore from "./device-flow-store.ts";
import * as GitHub from "./github-identity.ts";

// The interactive part of OAuth 2.1, served by the provider's `defaultHandler`:
//
//   GET  /authorize          consent page for the client (name, redirect host)
//   POST /authorize          Allow → sign in (below), Deny → access_denied to the client
//   GET  /authorize/session  the web sign-in: grant for the user of the web session cookie, or
//                            send the browser to the web app's login page, which returns here
//   GET  /authorize/device   the GitHub user code and link; the page polls the endpoint below
//   POST /authorize/poll     one poll of GitHub; on success grant if the account has a user
//
// On a custom domain the MCP server shares the web app's host, so it sees the web session cookie
// (`webSignIn`): the user signs in there with a passkey, Google or GitHub, in the same browser
// (the Claude iOS sheet included) by redirects alone, and the api mints the grant's token for that
// session's user. Everywhere else (the old `workers.dev` origin, other stages, local dev) and as a
// fallback link, the GitHub Device Flow signs in, with no GitHub redirect and no client secret.
//
// The approved request waits in the provider's upstream transaction (bound to the browser by a
// cookie), and a device code in `device-flow-store`, both keyed by the upstream `state`.
// The provider itself serves metadata, `/register`, `/token` and the bearer check on `/mcp`.

export const authorizePath = "/authorize";
export const devicePath = "/authorize/device";
export const pollPath = "/authorize/poll";
export const sessionPath = "/authorize/session";

/** The web app's login page; it opens `redirect` (a path on this host) once signed in. */
export const loginPath = "/login";

/** GitHub's `slow_down` adds this many seconds to the interval. */
const slowDownSeconds = 5;

/**
 * Props stored with the grant, encrypted by the provider. The MCP handler sees them as
 * `ctx.props`. `apiToken` is the api token minted for this grant (`Claude (MCP)` in Settings): the
 * tools call the api with it.
 */
export interface Props {
  readonly login: string;
  readonly apiToken: string;
}

export interface Options {
  readonly origin: string;
  readonly github: Layer.Layer<GitHub.GitHubIdentity>;
  /**
   * Mints the api token for a new grant, for the verified GitHub account, over the Service
   * Binding. The api decides who that is: `null` when the account has no Stash user (the client
   * then gets `access_denied`). Rejects if the api is unreachable: the client gets `server_error`.
   */
  readonly mintApiToken: (account: {
    readonly login: string;
    readonly id: string;
  }) => Promise<string | null>;
  /**
   * The web sign-in, when this origin is the web app's (a custom domain): mints the grant's api
   * token for the user of a web session cookie, with that user's id. `null` when the session is
   * unknown or expired (the browser is sent to sign in). Rejects if the api is unreachable.
   */
  readonly webSignIn?: {
    readonly mintForSession: (session: string) => Promise<{
      readonly token: string;
      readonly userId: string;
      /** Revokes the token again: the sign-in it was minted for did not finish. Never fails. */
      readonly revoke: () => Promise<void>;
    } | null>;
  };
  /** Whether the GitHub Device Flow can run (`GITHUB_CLIENT_ID` is set). Defaults to `true`. */
  readonly githubConfigured?: boolean;
  /** Epoch milliseconds. Tests pass a clock they control. */
  readonly now?: () => number;
}

/** A cookie's value from a request's `Cookie` header. */
const cookieOf = (request: Request, name: string): string | undefined => {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
};

/** What `POST /authorize/poll` answers. The device page acts on `status`. */
export type PollResponse =
  | { readonly status: "pending" | "slow_down"; readonly interval: number }
  | { readonly status: "complete"; readonly redirectTo: string }
  | {
      readonly status: "expired" | "denied" | "not_allowed" | "failed";
      readonly message: string;
      readonly redirectTo?: string;
    };

const html = (body: string, headers = new Headers(), status = 200) => {
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(body, { status, headers });
};

const json = (body: PollResponse, headers = new Headers()) => {
  headers.set("cache-control", "no-store");
  return Response.json(body, { headers });
};

const text = (message: string, status: number) =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

const redirect = (location: string, headers = new Headers(), status = 302) => {
  headers.set("location", location);
  return new Response(null, { status, headers });
};

const makeNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

export const make = (options: Options) => {
  const now = options.now ?? Date.now;
  const githubConfigured = options.githubConfigured ?? true;
  const github = <A, E>(effect: Effect.Effect<A, E, GitHub.GitHubIdentity>) =>
    Effect.runPromise(Effect.provide(effect, options.github));

  const showConsent = async (request: Request, oauth: OAuthHelpers) => {
    const authRequest = await oauth.parseAuthRequest(request);
    // Describe first: a failed client lookup leaves nothing in KV.
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    return html(
      Pages.consent(details, consent.handle, {
        web: options.webSignIn !== undefined,
        github: githubConfigured,
      }),
      consent.headers,
    );
  };

  // Sends the approved request on to the web sign-in, which comes back to `sessionPath`.
  const toWebSignIn = async (
    oauth: OAuthHelpers,
    approved: { request: AuthRequest; headers: Headers },
  ) => {
    const upstream = await oauth.beginUpstream(approved.request, { headers: approved.headers });
    const location = new URL(sessionPath, options.origin);
    location.searchParams.set("state", upstream.state);
    return redirect(location.toString(), upstream.headers, 303);
  };

  const decide = async (request: Request, oauth: OAuthHelpers, kv: KVNamespace) => {
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve" && form.get("decision") !== "approve-device") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(request, handle);
    const decision = form.get("decision");
    if (options.webSignIn !== undefined && decision !== "approve-device") {
      return toWebSignIn(oauth, approved);
    }
    if (!githubConfigured) {
      return redirect(
        authorizationErrorRedirect(approved.request, "server_error", "Sign-in is not configured"),
        approved.headers,
      );
    }
    const started = await github(GitHub.GitHubIdentity.use((identity) => identity.start)).then(
      (flow) => ({ ok: true as const, flow }),
      () => ({ ok: false as const }),
    );
    if (!started.ok) {
      return redirect(
        authorizationErrorRedirect(approved.request, "server_error", "GitHub sign-in failed"),
        approved.headers,
      );
    }
    const { flow } = started;
    const upstream = await oauth.beginUpstream(approved.request, { headers: approved.headers });
    const at = now();
    await DeviceFlowStore.make(kv).put(
      upstream.state,
      {
        deviceCode: flow.deviceCode,
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        interval: flow.interval,
        expiresAt: at + Math.min(flow.expiresIn, DeviceFlowStore.maxSeconds) * 1000,
        nextPollAt: at + flow.interval * 1000,
      },
      at,
    );
    const location = new URL(devicePath, options.origin);
    location.searchParams.set("state", upstream.state);
    // 303, so reloading the code page does not post the consent form again.
    return redirect(location.toString(), upstream.headers, 303);
  };

  const showDevice = async (request: Request, kv: KVNamespace) => {
    const state = new URL(request.url).searchParams.get("state") ?? "";
    const flow = await DeviceFlowStore.make(kv).get(state);
    if (flow === null) return text("This sign-in expired. Start again from the app.", 400);
    const nonce = makeNonce();
    const headers = new Headers({
      "cache-control": "no-store",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    });
    return html(
      Pages.device(
        {
          state,
          userCode: flow.userCode,
          verificationUri: flow.verificationUri,
          interval: flow.interval,
          pollPath,
        },
        nonce,
      ),
      headers,
    );
  };

  const grant = async (
    oauth: OAuthHelpers,
    request: AuthRequest,
    login: string,
    apiToken: string,
  ) => {
    const { redirectTo } = await oauth.completeAuthorization({
      request,
      userId: login,
      metadata: {},
      scope: request.scope,
      props: { login, apiToken } satisfies Props,
    });
    return redirectTo;
  };

  // The web sign-in's return: grant for the session's user, or sign in first. The session is
  // checked (by minting) before the upstream transaction is taken, which works only once.
  const finishSession = async (request: Request, oauth: OAuthHelpers) => {
    const webSignIn = options.webSignIn;
    if (webSignIn === undefined) return text("Not found", 404);
    const state = new URL(request.url).searchParams.get("state") ?? "";
    const here = `${sessionPath}?${new URLSearchParams({ state })}`;
    const login = new URL(loginPath, options.origin);
    login.searchParams.set("redirect", here);
    const session = cookieOf(request, Security.sessionCookieName);
    if (session === undefined || session === "") return redirect(login.toString());
    const minted = await webSignIn.mintForSession(session).catch(() => undefined);
    if (minted === null) return redirect(login.toString());
    // The upstream transaction works once, so it is taken only with a token in hand. When it can't
    // be (a forged or stale `state`, another browser), the token goes again: none stays unused.
    const resumed = await oauth
      .finishUpstream(
        new Request(new URL(here, options.origin), {
          headers: { cookie: request.headers.get("cookie") ?? "" },
        }),
      )
      .catch(async (error: unknown) => {
        await minted?.revoke();
        throw error;
      });
    if (minted === undefined) {
      return redirect(
        authorizationErrorRedirect(
          resumed.request,
          "server_error",
          "Stash could not issue a token",
        ),
        resumed.headers,
      );
    }
    return redirect(
      await grant(oauth, resumed.request, minted.userId, minted.token),
      resumed.headers,
    );
  };

  const poll = async (request: Request, oauth: OAuthHelpers, kv: KVNamespace) => {
    const form = await request.formData();
    const state = String(form.get("state") ?? "");
    const store = DeviceFlowStore.make(kv);
    const flow = await store.get(state);
    if (flow === null) {
      return json({
        status: "expired",
        message: "This sign-in expired. Start again from the app.",
      });
    }
    const at = now();
    // Several tabs or an eager page must not make GitHub answer `slow_down`.
    if (at < flow.nextPollAt) return json({ status: "pending", interval: flow.interval });

    const result = await github(
      GitHub.GitHubIdentity.use((identity) => identity.poll(flow.deviceCode)),
    ).catch((): GitHub.Poll | undefined => undefined);
    if (result?._tag === "Pending" || result?._tag === "SlowDown") {
      const interval = flow.interval + (result._tag === "SlowDown" ? slowDownSeconds : 0);
      await store.put(state, { ...flow, interval, nextPollAt: at + interval * 1000 }, at);
      return json({ status: result._tag === "Pending" ? "pending" : "slow_down", interval });
    }

    // Every other answer ends the flow: recover the approved request (the browser's binding
    // cookie must match) and either grant or send the client an error.
    await store.delete(state);
    const finishUrl = new URL(pollPath, options.origin);
    finishUrl.searchParams.set("state", state);
    const resumed = await oauth.finishUpstream(
      new Request(finishUrl, { headers: { cookie: request.headers.get("cookie") ?? "" } }),
    );
    const fail = (
      status: "expired" | "denied" | "not_allowed" | "failed",
      message: string,
      code: "access_denied" | "server_error" = "access_denied",
    ) =>
      json(
        {
          status,
          message,
          redirectTo: authorizationErrorRedirect(resumed.request, code, message),
        },
        resumed.headers,
      );

    if (result === undefined) return fail("failed", "GitHub sign-in failed", "server_error");
    if (result._tag === "Expired") return fail("expired", "The code expired. Start again.");
    if (result._tag === "Denied") return fail("denied", "Sign-in was cancelled on GitHub.");
    // The api knows the users (the owner and the invited members) and mints a token only for one
    // of them, so the token always acts for exactly the person who signed in.
    const apiToken = await options
      .mintApiToken({ login: result.login, id: result.id })
      .catch(() => undefined);
    if (apiToken === undefined) {
      return fail("failed", "Stash could not issue a token. Try again.", "server_error");
    }
    if (apiToken === null) {
      return fail("not_allowed", "This GitHub account may not use this server");
    }
    return json(
      {
        status: "complete",
        redirectTo: await grant(oauth, resumed.request, result.login, apiToken),
      },
      resumed.headers,
    );
  };

  return async (request: Request, oauth: OAuthHelpers, kv: KVNamespace): Promise<Response> => {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === authorizePath && request.method === "GET") {
        return await showConsent(request, oauth);
      }
      if (pathname === authorizePath && request.method === "POST") {
        return await decide(request, oauth, kv);
      }
      if (pathname === sessionPath && request.method === "GET") {
        return await finishSession(request, oauth);
      }
      if (pathname === devicePath && request.method === "GET") {
        return await showDevice(request, kv);
      }
      if (pathname === pollPath && request.method === "POST") {
        return await poll(request, oauth, kv).catch((error: unknown) => {
          // The upstream transaction is gone or bound to another browser: nothing to redirect to.
          if (error instanceof AuthorizationError) {
            return json({ status: "failed", message: error.description });
          }
          throw error;
        });
      }
      return text("Not found", 404);
    } catch (error) {
      // See the provider's docs/consent-page.md: redirect only to a validated client.
      if (error instanceof AuthorizationError && error.redirectTo !== undefined) {
        return redirect(error.redirectTo);
      }
      if (error instanceof AuthorizationError) return text(error.description, 400);
      if (error instanceof CimdFetchError) return text("This app could not be verified.", 400);
      throw error;
    }
  };
};
