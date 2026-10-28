import {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Effect, Layer } from "effect";
import * as Pages from "./authorize-pages.ts";
import * as DeviceFlowStore from "./device-flow-store.ts";
import * as GitHub from "./github-identity.ts";

// The interactive part of OAuth 2.1, served by the provider's `defaultHandler`. The owner signs in
// with the GitHub Device Flow, so there is no GitHub redirect and no client secret:
//
//   GET  /authorize         consent page for the client (name, redirect host)
//   POST /authorize         Allow → start a device flow, Deny → access_denied to the client
//   GET  /authorize/device  the user code and the GitHub link; the page polls the endpoint below
//   POST /authorize/poll    one poll of GitHub; on success grant if it is the allowlisted login
//
// The approved request waits in the provider's upstream transaction (bound to the browser by a
// cookie), and the device code in `device-flow-store`, both keyed by the upstream `state`.
// The provider itself serves metadata, `/register`, `/token` and the bearer check on `/mcp`.

export const authorizePath = "/authorize";
export const devicePath = "/authorize/device";
export const pollPath = "/authorize/poll";

/** GitHub's `slow_down` adds this many seconds to the interval. */
const slowDownSeconds = 5;

/** Props stored with the grant. The MCP handler sees them as `ctx.props`. */
export interface Props {
  readonly login: string;
}

export interface Options {
  readonly origin: string;
  readonly allowedLogin: string;
  readonly github: Layer.Layer<GitHub.GitHubIdentity>;
  /** Epoch milliseconds. Tests pass a clock they control. */
  readonly now?: () => number;
}

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
  const allowedLogin = options.allowedLogin.toLowerCase();
  const now = options.now ?? Date.now;
  const github = <A, E>(effect: Effect.Effect<A, E, GitHub.GitHubIdentity>) =>
    Effect.runPromise(Effect.provide(effect, options.github));

  const showConsent = async (request: Request, oauth: OAuthHelpers) => {
    const authRequest = await oauth.parseAuthRequest(request);
    // Describe first: a failed client lookup leaves nothing in KV.
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    return html(Pages.consent(details, consent.handle), consent.headers);
  };

  const decide = async (request: Request, oauth: OAuthHelpers, kv: KVNamespace) => {
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(request, handle);
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

  const grant = async (oauth: OAuthHelpers, request: AuthRequest, login: string) => {
    const { redirectTo } = await oauth.completeAuthorization({
      request,
      userId: login,
      metadata: {},
      scope: request.scope,
      props: { login } satisfies Props,
    });
    return redirectTo;
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
    if (result.login.toLowerCase() !== allowedLogin) {
      return fail("not_allowed", "This GitHub account may not use this server");
    }
    return json(
      { status: "complete", redirectTo: await grant(oauth, resumed.request, result.login) },
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
