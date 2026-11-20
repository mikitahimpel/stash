// `pnpm --filter @stash/web walk:sign-in`: walks the sign-in of #178 in headless Chromium against
// the real api under `alchemy dev` (no credentials, its own stage and ports) and the Vite dev
// server, and exits 1 on the first step that fails:
//
// 1. Passkeys, with a CDP virtual authenticator (internal, resident keys, user verification): an
//    invite link signs a new member up with a passkey; signed out, the same passkey signs them in
//    from the login page with one button and no user name; Settings → Security lists it and won't
//    remove the only way in.
// 2. Google, against a fake OpenID provider this script serves (`GOOGLE_FAKE_IDP`): the
//    authorization code flow with PKCE, state and nonce, an RS256 ID token from a key made for the
//    run. An invite link signs a new Google account up; signed out, the same `sub` signs in from
//    the login page with no invite; an account without an invite is refused with a message.
//
// Every account, key and address is synthetic, and every server stops at the end.
import { type ChildProcess, spawn } from "node:child_process";
import * as Crypto from "node:crypto";
import * as Http from "node:http";
import * as Path from "node:path";
import { type BrowserContext, chromium, type Page } from "playwright";

const appDir = Path.resolve(import.meta.dirname, "..");
const repoRoot = Path.resolve(appDir, "../..");

const apiPort = Number(process.env["STASH_WALK_API_PORT"] ?? 8807);
const webPort = Number(process.env["STASH_WALK_WEB_PORT"] ?? 5189);
const idpPort = Number(process.env["STASH_WALK_IDP_PORT"] ?? 8817);
const apiUrl = `http://localhost:${apiPort}`;
// `localhost`, not 127.0.0.1: the passkeys' RP id is the web origin's host.
const webUrl = `http://localhost:${webPort}`;
const idpUrl = `http://localhost:${idpPort}`;
const clientId = "synthetic-walk-client-id";
const clientSecret = "synthetic-walk-client-secret";

// --- The fake OpenID provider -------------------------------------------------------------------

const keys = Crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...keys.publicKey.export({ format: "jwk" }),
  kid: "walk-key",
  alg: "RS256",
  use: "sig",
};
/** The Google account the next sign-in picks. */
let nextAccount = { sub: "walk-google-sub", email: "walker@example.com" };
const codes = new Map<string, { nonce: string; challenge: string; sub: string; email: string }>();

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const idToken = (claims: Record<string, unknown>) => {
  const signed = `${b64(JSON.stringify({ alg: "RS256", kid: "walk-key", typ: "JWT" }))}.${b64(JSON.stringify(claims))}`;
  return `${signed}.${b64(Crypto.sign("sha256", Buffer.from(signed), keys.privateKey))}`;
};

const idp = Http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", idpUrl);
  if (req.method === "GET" && url.pathname === "/authorize") {
    // Google would show its account picker here; the fake picks `nextAccount` at once.
    const q = url.searchParams;
    const ok =
      q.get("client_id") === clientId &&
      q.get("response_type") === "code" &&
      q.get("code_challenge_method") === "S256";
    const back = new URL(q.get("redirect_uri") ?? "");
    if (!ok) back.searchParams.set("error", "invalid_request");
    else {
      const code = Crypto.randomBytes(16).toString("hex");
      codes.set(code, {
        nonce: q.get("nonce") ?? "",
        challenge: q.get("code_challenge") ?? "",
        ...nextAccount,
      });
      back.searchParams.set("code", code);
    }
    back.searchParams.set("state", q.get("state") ?? "");
    res.writeHead(302, { location: back.toString() }).end();
    return;
  }
  if (req.method === "POST" && url.pathname === "/token") {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      const form = new URLSearchParams(body);
      const issued = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const verified =
        issued !== undefined &&
        form.get("client_secret") === clientSecret &&
        b64(
          Crypto.createHash("sha256")
            .update(form.get("code_verifier") ?? "")
            .digest(),
        ) === issued.challenge;
      if (!verified) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "synthetic-access-token",
          id_token: idToken({
            iss: idpUrl,
            aud: clientId,
            sub: issued.sub,
            email: issued.email,
            email_verified: true,
            iat: now,
            exp: now + 600,
            nonce: issued.nonce,
          }),
        }),
      );
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/jwks") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  res.writeHead(404).end();
});

// --- Servers ------------------------------------------------------------------------------------

// node:http keeps the script off the `fetch` global, which oxlint reserves for platform packages.
const call = (method: string, url: string, body?: unknown): Promise<number> =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = payload === undefined ? {} : { "content-type": "application/json" };
    const req = Http.request(url, { method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end(payload);
  });

const children: Array<ChildProcess> = [];
const start = (name: string, command: string, args: Array<string>, cwd: string, env = {}) => {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  children.push(child);
  return { output: () => `${name}:\n${output}` };
};

// SIGINT lets alchemy stop workerd and its sidecar; the process group goes down with it.
const stopAll = () =>
  Promise.all(
    children.map(async (child) => {
      if (child.pid === undefined || child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      process.kill(-child.pid, "SIGINT");
      const timer = setTimeout(() => process.kill(-child.pid!, "SIGKILL"), 10_000);
      await exited;
      clearTimeout(timer);
    }),
  );

const waitFor = async (what: string, url: string, logs: () => string, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await call("GET", url).catch(() => 0)) === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${what}\n${logs()}`);
};

/** An open invite in the local database, by its token's hash; returns the token. */
const newInvite = async () => {
  const token = Crypto.randomBytes(32).toString("base64url");
  const hash = Crypto.createHash("sha256").update(token).digest("hex");
  if ((await call("POST", `${apiUrl}/_smoke/invite`, { hash })) !== 201) {
    throw new Error("seeding an invite failed");
  }
  return token;
};

// --- The walk -----------------------------------------------------------------------------------

const step = (name: string) => console.log(`· ${name}`);

/** Signed in once the app leaves the login or invite page for the Inbox. */
const signedIn = (page: Page) =>
  page.waitForURL((url) => url.pathname.startsWith("/links"), { timeout: 15_000 });

const withAuthenticator = async (context: BrowserContext, page: Page) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
};

const signOut = (context: BrowserContext) => context.clearCookies();

const walkPasskeys = async (context: BrowserContext) => {
  const page = await context.newPage();
  await withAuthenticator(context, page);

  step("passkey: sign up from an invite link");
  await page.goto(`${webUrl}/invite/${await newInvite()}`);
  await page.locator("[data-test=invite][data-state=open]").waitFor();
  if (!(await page.getByText("You were invited to Stash").isVisible())) {
    throw new Error("the invite page does not say the visitor was invited");
  }
  await page.getByRole("button", { name: "Continue with passkey" }).click();
  await signedIn(page);

  step("passkey: sign in with one button and no user name");
  await signOut(context);
  await page.goto(`${webUrl}/login`);
  await page.getByRole("button", { name: "Continue with passkey" }).click();
  await signedIn(page);

  step("passkey: Settings → Security lists it, and keeps the last way in");
  await page.goto(`${webUrl}/settings#security`);
  await page.locator("[data-test=security] [data-test=passkey]").first().waitFor();
  const rows = await page.locator("[data-test=security] [data-test=passkey]").count();
  if (rows !== 1) throw new Error(`expected one passkey in Settings, found ${rows}`);
  if (!(await page.locator("[data-test=remove-passkey]").isDisabled())) {
    throw new Error("the only passkey can be removed");
  }
  await page.close();
};

const walkGoogle = async (context: BrowserContext) => {
  const page = await context.newPage();

  step("Google: sign up from an invite link");
  nextAccount = { sub: "walk-google-sub", email: "walker@example.com" };
  await page.goto(`${webUrl}/invite/${await newInvite()}`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await signedIn(page);
  await page.goto(`${webUrl}/settings#security`);
  await page.locator("[data-test=account]", { hasText: "walker@example.com" }).waitFor();

  step("Google: the same account signs in by its sub, with no invite");
  await signOut(context);
  nextAccount = { sub: "walk-google-sub", email: "renamed@example.com" };
  await page.goto(`${webUrl}/login`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await signedIn(page);

  step("Google: an account without an invite is refused");
  await signOut(context);
  nextAccount = { sub: "walk-stranger-sub", email: "stranger@example.com" };
  await page.goto(`${webUrl}/login`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL((url) => url.searchParams.get("signin") === "google_not_allowed");
  await page.locator("[data-test=sign-in-error]").waitFor();
  await page.close();
};

const main = async () => {
  await new Promise<void>((resolve) => idp.listen(idpPort, "localhost", resolve));
  const alchemyEnv: Record<string, string | undefined> = {
    STASH_API_PORT: String(apiPort),
    STASH_MCP_PORT: String(apiPort + 1),
    STASH_WEB_PORT: String(apiPort + 2),
    STASH_WEB_ORIGIN: webUrl,
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_FAKE_IDP: idpUrl,
  };
  // Never deploy anything: the stack runs locally without Cloudflare credentials.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("CLOUDFLARE_")) alchemyEnv[key] = undefined;
  }
  const api = start(
    "alchemy dev",
    "node_modules/.bin/alchemy",
    ["dev", "--stage", "sign-in-walk"],
    repoRoot,
    alchemyEnv,
  );
  await waitFor("the api", `${apiUrl}/health`, api.output);
  const web = start(
    "vite",
    "node_modules/.bin/vite",
    ["--host", "0.0.0.0", "--port", String(webPort), "--strictPort"],
    appDir,
    { STASH_DEV_API_URL: apiUrl },
  );
  await waitFor("the web dev server", `${webUrl}/login`, web.output);

  const browser = await chromium.launch();
  try {
    // One context each: a browser of its own, with its own cookies.
    for (const walk of [walkPasskeys, walkGoogle]) {
      const context = await browser.newContext();
      try {
        await walk(context);
      } finally {
        await context.close();
      }
    }
    console.log("✓ sign-in walk");
  } finally {
    await browser.close();
  }
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopAll();
  idp.close();
}
