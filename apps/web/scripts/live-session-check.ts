// `pnpm --filter @stash/web check:live`: checks a deployed web origin end to end with plain HTTP
// requests (no browser), and exits 1 on the first failure:
//
// 1. `POST <web>/api/auth/device/start` answers 200 with a `userCode`, so the api is served
//    same-origin under `/api`.
// 2. No script or stylesheet the page loads names a `stash-api.` origin.
// 3. The session cookie round-trips on the web origin. A real session needs a person on
//    github.com, so the check seeds a synthetic one instead: the SHA-256 hash of a random token goes
//    straight into the deployed D1 `sessions` table through the Cloudflare API, with the deploy's
//    own credentials (the same row a completed Device Flow writes). No route or code path is added
//    to the api, so prod auth is unchanged. The cookie the api sets from `/api/auth/logout` carries
//    the same attributes as the one `poll` sets (`cookieOptions` in `@stash/backend-auth`), so a
//    small RFC 6265 cookie jar stores the session under them, as a browser would. The jar must then
//    send it on `<web>/api/auth/me` (answered 200 with the user), and never to the api's own
//    origin. Logging out ends the session, and the row is deleted in any case.
//
// Env: `STASH_WEB_URL` (the deployed web origin), `STASH_D1_DATABASE` (the api's D1 database name,
// `PROD_NAMES.Database` in `alchemy.run.ts` for stage `prod`), `STASH_ALLOWED_GITHUB_LOGIN` (the
// login the api allows), and `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` through `pp run` (see
// docs/deploy.md). Nothing secret is printed: neither the account id, the token nor the session.
import * as Crypto from "node:crypto";
import * as Https from "node:https";

interface Answer {
  readonly status: number;
  readonly headers: Record<string, string | Array<string> | undefined>;
  readonly body: string;
}

const request = (
  method: string,
  url: string,
  options: { readonly headers?: Record<string, string>; readonly body?: string } = {},
): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const req = Https.request(url, { method, headers: options.headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    // The URL may carry the account id, so only the error code is reported.
    req.on("error", (error: NodeJS.ErrnoException) =>
      reject(new Error(`request failed: ${error.code ?? "unknown error"}`)),
    );
    req.end(options.body);
  });

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
};

const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(`FAIL ${message}`);
  console.log(`ok   ${message}`);
};

// --- A minimal RFC 6265 cookie jar: host-only cookies, path match, Secure, Max-Age 0 deletes ---

interface Cookie {
  readonly name: string;
  readonly value: string;
  readonly host: string;
  readonly hostOnly: boolean;
  readonly path: string;
  readonly secure: boolean;
  readonly attributes: ReadonlyArray<string>;
}

const parseSetCookie = (header: string, from: URL): Cookie | "delete" => {
  const [pair = "", ...rest] = header.split(";").map((part) => part.trim());
  const name = pair.slice(0, pair.indexOf("="));
  const attribute = (key: string) =>
    rest.find((a) => a.toLowerCase().startsWith(`${key.toLowerCase()}=`))?.slice(key.length + 1);
  if (attribute("Max-Age") === "0") return "delete";
  const domain = attribute("Domain");
  const path = attribute("Path");
  return {
    name,
    value: pair.slice(name.length + 1),
    host: domain === undefined ? from.hostname : domain.replace(/^\./, ""),
    hostOnly: domain === undefined,
    path: path?.startsWith("/") ? path : from.pathname.replace(/\/[^/]*$/, "") || "/",
    secure: rest.some((a) => a.toLowerCase() === "secure"),
    attributes: rest,
  };
};

const pathMatches = (cookiePath: string, requestPath: string) =>
  requestPath === cookiePath ||
  (requestPath.startsWith(cookiePath) &&
    (cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/"));

const cookieHeader = (jar: ReadonlyArray<Cookie>, to: URL): string =>
  jar
    .filter(
      (c) =>
        (c.hostOnly
          ? to.hostname === c.host
          : to.hostname === c.host || to.hostname.endsWith(`.${c.host}`)) &&
        pathMatches(c.path, to.pathname) &&
        (!c.secure || to.protocol === "https:"),
    )
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

// --- D1 through the Cloudflare API ---

const d1 = async () => {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const token = required("CLOUDFLARE_API_TOKEN");
  const name = required("STASH_D1_DATABASE");
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const list = await request("GET", `${base}?name=${encodeURIComponent(name)}`, { headers });
  const found = (
    JSON.parse(list.body) as { result?: Array<{ uuid: string; name: string }> }
  ).result?.find((db) => db.name === name);
  if (list.status !== 200 || found === undefined) {
    throw new Error(`D1 database ${name} not found (Cloudflare API answered ${list.status})`);
  }
  return async (sql: string, params: ReadonlyArray<string>) => {
    const answer = await request("POST", `${base}/${found.uuid}/query`, {
      headers,
      body: JSON.stringify({ sql, params }),
    });
    if (answer.status !== 200) throw new Error(`D1 query answered ${answer.status}`);
  };
};

const main = async () => {
  const web = new URL(required("STASH_WEB_URL"));
  const login = required("STASH_ALLOWED_GITHUB_LOGIN");
  const at = (path: string) => new URL(path, web);

  // 1. The api is same-origin under /api.
  const start = await request("POST", at("/api/auth/device/start").href);
  const started = start.status === 200 ? (JSON.parse(start.body) as { userCode?: string }) : {};
  check(
    start.status === 200 && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(started.userCode ?? ""),
    `POST /api/auth/device/start on the web origin: ${start.status} with a userCode`,
  );

  // 2. The bundle names no api origin.
  const page = await request("GET", web.href);
  const assets = [...page.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]!);
  check(assets.length > 0, `the page loads ${assets.length} bundled assets`);
  for (const asset of assets) {
    const file = await request("GET", at(asset).href);
    check(
      file.status === 200 && !file.body.includes("stash-api."),
      `${asset}: no stash-api. origin`,
    );
  }

  // 3. The session cookie round-trips on the web origin.
  const query = await d1();
  const hash = (token: string) => Crypto.createHash("sha256").update(token).digest("hex");
  const tokens = [0, 1].map(() => Crypto.randomBytes(32).toString("base64url"));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  try {
    for (const token of tokens) {
      await query("INSERT INTO sessions (id, github_login, expires_at) VALUES (?, ?, ?)", [
        hash(token),
        login,
        expiresAt,
      ]);
    }
    const [first = "", second = ""] = tokens;

    // The cookie the api sets on the web origin, from a response to `/api/...`.
    const logoutUrl = at("/api/auth/logout");
    const ended = await request("POST", logoutUrl.href, {
      headers: { cookie: `stash_session=${first}` },
    });
    const setCookie = [ended.headers["set-cookie"] ?? []]
      .flat()
      .find((h) => h.startsWith("stash_session="));
    check(ended.status === 204 && setCookie !== undefined, "/api/auth/logout sets stash_session");
    const attributes = setCookie!.split(";").map((a) => a.trim().toLowerCase());
    for (const expected of ["path=/", "samesite=lax", "secure", "httponly"]) {
      check(attributes.includes(expected), `the cookie carries ${expected}`);
    }
    check(!attributes.some((a) => a.startsWith("domain=")), "the cookie has no Domain (host-only)");

    // Stored as `poll` would set it: the same attributes, the session's value and lifetime.
    const stored = parseSetCookie(
      setCookie!
        .replace(/^stash_session=[^;]*/, `stash_session=${second}`)
        .replace(/Max-Age=0/i, "Max-Age=2592000"),
      logoutUrl,
    );
    if (stored === "delete") throw new Error("FAIL the stored cookie would be deleted");
    const jar = [stored];

    const meUrl = at("/api/auth/me");
    const sent = cookieHeader(jar, meUrl);
    check(sent === `stash_session=${second}`, "the jar sends the cookie on /api/auth/me");
    const me = await request("GET", meUrl.href, { headers: { cookie: sent } });
    check(
      me.status === 200 && JSON.parse(me.body).kind === "user",
      `/api/auth/me: ${me.status} user`,
    );
    check(
      cookieHeader(
        jar,
        new URL("/auth/me", `https://${web.hostname.replace(/^stash-web/, "stash-api")}`),
      ) === "",
      "the jar never sends it to the api's own origin",
    );

    const out = await request("POST", logoutUrl.href, { headers: { cookie: sent } });
    const after = await request("GET", meUrl.href, { headers: { cookie: sent } });
    check(out.status === 204 && after.status === 401, "logout ends the session: /api/auth/me 401");
  } finally {
    for (const token of tokens) await query("DELETE FROM sessions WHERE id = ?", [hash(token)]);
  }
};

try {
  await main();
  console.log("live session check passed");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
