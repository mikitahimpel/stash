import {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
  type ConsentDescription,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Effect, Layer } from "effect";
import * as GitHub from "./github-identity.ts";

// The interactive part of OAuth 2.1, served by the provider's `defaultHandler`:
//
//   GET  /authorize  consent page for the client (name, redirect host)
//   POST /authorize  Allow → redirect to GitHub (PKCE), Deny → access_denied to the client
//   GET  /callback   GitHub login → grant if it is the allowlisted login, access_denied otherwise
//
// The provider itself serves metadata, `/register`, `/token` and the bearer check on `/mcp`.

export const authorizePath = "/authorize";
export const callbackPath = "/callback";

/** What the PKCE verifier for GitHub is stored as, encrypted, between redirect and callback. */
interface Upstream {
  readonly verifier: string;
}

/** Props stored with the grant. The MCP handler sees them as `ctx.props`. */
export interface Props {
  readonly login: string;
}

export interface Options {
  readonly origin: string;
  readonly allowedLogin: string;
  readonly github: Layer.Layer<GitHub.GitHubIdentity>;
}

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const html = (body: string, headers = new Headers(), status = 200) => {
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(`<!doctype html>\n<meta charset="utf-8">\n${body}`, { status, headers });
};

const text = (message: string, status: number) =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

const redirect = (location: string, headers = new Headers()) => {
  headers.set("location", location);
  return new Response(null, { status: 302, headers });
};

const consentPage = (details: ConsentDescription, handle: string) => {
  const name = escape(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : "This app registered itself, so its name is not verified.";
  const loopback = details.redirectIsLoopback
    ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>"
    : "";
  return `<title>Authorize ${name}</title>
<h1>Allow ${name} to use your Stash?</h1>
<p>${origin} Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${loopback}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <p><button name="decision" value="approve">Continue with GitHub</button> <button name="decision" value="deny">Deny</button></p>
</form>`;
};

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const s256 = async (verifier: string) =>
  base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );

const makeVerifier = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));

export const make = (options: Options) => {
  const redirectUri = new URL(callbackPath, options.origin).toString();
  const allowedLogin = options.allowedLogin.toLowerCase();
  const github = <A, E>(effect: Effect.Effect<A, E, GitHub.GitHubIdentity>) =>
    Effect.runPromise(Effect.provide(effect, options.github));

  const showConsent = async (request: Request, oauth: OAuthHelpers) => {
    const authRequest = await oauth.parseAuthRequest(request);
    // Describe first: a failed client lookup leaves nothing in KV.
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    return html(consentPage(details, consent.handle), consent.headers);
  };

  const decide = async (request: Request, oauth: OAuthHelpers) => {
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(request, handle);
    const verifier = makeVerifier();
    const upstream = await oauth.beginUpstream(approved.request, {
      data: { verifier } satisfies Upstream,
      headers: approved.headers,
    });
    const codeChallenge = await s256(verifier);
    const location = await github(
      GitHub.GitHubIdentity.useSync((identity) =>
        identity.authorizeUrl({ state: upstream.state, codeChallenge, redirectUri }),
      ),
    );
    return redirect(location, upstream.headers);
  };

  const callback = async (request: Request, oauth: OAuthHelpers) => {
    const { request: original, data, headers } = await oauth.finishUpstream<Upstream>(request);
    const params = new URL(request.url).searchParams;
    const code = params.get("code");
    if (params.has("error") || code === null) {
      return redirect(authorizationErrorRedirect(original, "access_denied"), headers);
    }
    const login = await github(
      GitHub.GitHubIdentity.use((identity) =>
        identity.login({ code, codeVerifier: data.verifier, redirectUri }),
      ).pipe(Effect.option),
    );
    if (login._tag === "None") {
      return redirect(
        authorizationErrorRedirect(original, "server_error", "GitHub sign-in failed"),
        headers,
      );
    }
    if (login.value.toLowerCase() !== allowedLogin) {
      return redirect(
        authorizationErrorRedirect(
          original,
          "access_denied",
          "This GitHub account may not use this server",
        ),
        headers,
      );
    }
    const { redirectTo } = await oauth.completeAuthorization({
      request: original,
      userId: login.value,
      metadata: {},
      scope: original.scope,
      props: { login: login.value } satisfies Props,
    });
    return redirect(redirectTo, headers);
  };

  return async (request: Request, oauth: OAuthHelpers): Promise<Response> => {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === authorizePath && request.method === "GET") {
        return await showConsent(request, oauth);
      }
      if (pathname === authorizePath && request.method === "POST") {
        return await decide(request, oauth);
      }
      if (pathname === callbackPath && request.method === "GET") {
        return await callback(request, oauth);
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
