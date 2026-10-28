# Connecting Stash to Claude (custom connector)

`apps/mcp` is a remote MCP server. You add it to Claude once as a **custom connector**, and then
claude.ai, Claude Desktop, the Claude iOS app and Claude Code can search, save and organize your
stash. This page covers how sign-in works, how to add the connector in each client, the tools it
exposes, and what to check when it does not connect.

The MCP endpoint is:

```text
https://<your-mcp>.workers.dev/mcp
```

`<your-mcp>.workers.dev` stands for the host of the `Mcp` Worker. `alchemy deploy` prints it as
`mcpUrl` (see [alchemy.md](alchemy.md)). Always add the `/mcp` path. The bare origin serves only
the OAuth endpoints.

## Before you connect

The deploy must have these values set (see the config table in [alchemy.md](alchemy.md)). All of
them come from env, never from the repo.

| Env var | On `Mcp` as | Must be |
|---|---|---|
| `STASH_MCP_ORIGIN` | `MCP_ORIGIN` | the Worker's public origin, exactly as Claude reaches it (`https://<your-mcp>.workers.dev`, no path, no trailing slash). A deploy derives it when unset |
| `STASH_ALLOWED_GITHUB_LOGIN` | `ALLOWED_GITHUB_LOGIN` | your GitHub login. It is the only account that can authorize a client (compared case-insensitively) |
| `GITHUB_CLIENT_ID` | same name | the client ID of a GitHub OAuth App with **Enable Device Flow** checked. It is public, so it is a plain var. There is no client secret |
| `STASH_MCP_API_TOKEN` | `API_TOKEN` | an API token from `POST /tokens` on the api. The tools act as this token's principal |

`MCP_ORIGIN` is the OAuth issuer and sets the protected resource (`<origin>/mcp`). A deploy
derives it from the fixed Worker name and the account's `workers.dev` subdomain
(`https://stash-mcp.<subdomain>.workers.dev`), so set `STASH_MCP_ORIGIN` only for another host.
Until `GITHUB_CLIENT_ID` is set, `/authorize` answers 503. Device flow has no callback URL, so the
GitHub OAuth App does not depend on the origin (see [deploy.md](deploy.md#github-oauth-app-46)).

## How OAuth works

The connector uses the MCP authorization spec (OAuth 2.1 with PKCE). The `Mcp` Worker is both the
authorization server and the protected resource, built on `@cloudflare/workers-oauth-provider`
with its state (clients, grants, tokens) in the `OAUTH_KV` namespace. GitHub is only the upstream
identity, reached with the **GitHub Device Flow**: the Worker needs only the public client ID, and
GitHub never redirects back to it. Claude never sees a GitHub token, and the Worker keeps none.

1. Claude calls `/mcp` without a token and gets `401` with
   `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`.
2. Claude reads the protected resource metadata (RFC 9728), then the authorization server metadata
   at `/.well-known/oauth-authorization-server` (RFC 8414).
3. Claude registers itself at `/register` (Dynamic Client Registration, RFC 7591). You don't
   create a client ID by hand. Client ID Metadata Documents are not enabled.
4. Your browser opens `/authorize`, a consent page that shows the client's name and where access
   will be sent. **Deny** returns `access_denied` to Claude.
5. **Continue with GitHub** starts a device flow (`POST github.com/login/device/code`, scope
   `read:user`) and opens `/authorize/device`, which shows a user code such as `WDJB-MJHT` and a
   link to `github.com/login/device`. Open the link, sign in to GitHub, enter the code and
   authorize. Keep the Stash tab open: it polls `/authorize/poll`, and the Worker polls GitHub at
   the interval GitHub asks for (5 seconds more after each `slow_down`). The approved request and
   the device code wait in `OAUTH_KV`, bound to your browser by a cookie, for at most 10 minutes.
6. When GitHub returns a token, the Worker reads your login with it once, drops the token, and
   compares the login with `ALLOWED_GITHUB_LOGIN` (case-insensitively). The allowlisted login gets
   a grant, and the tab returns you to Claude with a code. Any other account sees "This GitHub
   account may not use this server", gets no grant, and Claude gets `access_denied`. An expired
   code or **Cancel** on GitHub ends the same way.
7. Claude exchanges its code at `/token` for an access token (1 hour) and a refresh token
   (30 days from sign-in, the provider defaults). Claude refreshes silently. After 30 days you
   sign in again.
8. Every `/mcp` request carries `Authorization: Bearer <access token>`. The Worker then calls
   `apps/api` over the `API` Service Binding with `API_TOKEN`. The MCP server owns no data.

You can check the metadata without signing in:

```sh
curl -s https://<your-mcp>.workers.dev/.well-known/oauth-authorization-server
curl -s https://<your-mcp>.workers.dev/.well-known/oauth-protected-resource/mcp
```

`issuer` must equal your origin, and `resource` must equal `<origin>/mcp`.

## Add the connector

### claude.ai, Claude Desktop and iOS

Custom connectors belong to your Claude account, so you add Stash once on claude.ai (or in
Desktop) and it shows up in Desktop and the iOS app too.

1. Open **Settings → Connectors** and choose **Add custom connector**. (On Team and Enterprise
   plans, an owner adds it for the organization first.)
2. Name: `Stash`. Remote MCP server URL: `https://<your-mcp>.workers.dev/mcp`.
3. Leave the **Advanced settings** (OAuth Client ID and Secret) empty. Claude registers itself
   (step 3 above).
4. Choose **Add**, then **Connect**. Approve the consent page, then enter the code it shows at
   `github.com/login/device`, signed in as the allowlisted GitHub account. On iOS you can open
   the GitHub link on any device; the Stash tab finishes on its own.
5. In a chat, enable Stash from the tools menu. Claude asks before it runs a tool unless you
   allow it always.

### Claude Code

```sh
claude mcp add --transport http stash https://<your-mcp>.workers.dev/mcp
```

Add `--scope user` to have it in every project (the default scope is the current project only).
Then run `/mcp` in Claude Code, pick `stash` and choose **Authenticate**. Claude Code opens the
browser for the same consent and device code sign-in, and listens on a loopback redirect, so the
consent page warns that access goes to an app on your computer. `claude mcp list` shows whether
the server is connected.

### Local dev

`pnpm dev:api` also runs `Mcp` at `http://localhost:8790/mcp` (`STASH_MCP_PORT`). The metadata and
the 401 challenge work there, but `GITHUB_CLIENT_ID` is the `dev_only` placeholder, so GitHub
rejects the device code request and the consent page returns `server_error` to the client. Set
`GITHUB_CLIENT_ID` to a real Device Flow client ID to sign in locally; no secret is needed.

## Tools

These are the tools `apps/mcp/src/mcp-server.ts` registers, from `packages/mcp/tools-*`.
`apps/mcp/test/oauth-handler.test.ts` checks the same list in `tools/list`.

| Tool | Package | What it does | Annotations |
|---|---|---|---|
| `save_link` | `tools-links` | Save a URL (optional title and tags). Tags, type and summary are added in the background | not read-only |
| `search_links` | `tools-links` | Search by meaning and keywords (`hybrid` or `keyword`), filter by type, status, tag; up to 50 hits | read-only |
| `list_links` | `tools-links` | List links newest first, all (`recent`) or `unseen`, filter by tag, type, status, with a cursor | read-only |
| `get_link` | `tools-links` | Get one link by id, with summary, tags and status | read-only |
| `set_link_status` | `tools-links` | Mark a link `new`, `seen`, `done` or `archived` | idempotent, not destructive |
| `list_open_tabs` | `tools-tabs` | List the tabs each device last reported, optionally for one device | read-only |
| `archive_tab` | `tools-tabs` | Save an open tab as a link, then close it on its device | not destructive |
| `close_tab_on_device` | `tools-tabs` | Close every tab with a URL on a device, without saving it | **destructive** |
| `get_latest_digest` | `tools-digest` | The latest digest: totals, top tags and highlights | read-only |

Every tool is closed-world: it only touches your stash. Closing a tab is queued as a device
command, and the device closes it the next time it checks for commands.

## Troubleshooting

| Symptom | Likely cause | Check or fix |
|---|---|---|
| Claude says it cannot connect, or never opens a sign-in page | The URL lacks `/mcp`, or `MCP_ORIGIN` differs from the URL you added (other host, `http` vs `https`, trailing path) | Use `<origin>/mcp`. Run the two `curl` commands above: `issuer` and `resource` must match it. Redeploy with the right `STASH_MCP_ORIGIN` |
| Continue with GitHub returns "GitHub sign-in failed" to Claude at once | GitHub refused the device code request: `GITHUB_CLIENT_ID` is wrong (or `dev_only`), or the OAuth App does not have **Enable Device Flow** checked | Check the client ID and the app setting, then redeploy |
| Sign-in ends with "This GitHub account may not use this server" | You entered the code while signed in to a GitHub account other than `ALLOWED_GITHUB_LOGIN` | Switch GitHub accounts at `github.com/login/device`, or fix `STASH_ALLOWED_GITHUB_LOGIN` and redeploy |
| The code page says the code expired, or "This sign-in expired" | More than 10 minutes passed, or the Stash tab was closed while waiting | Connect again from Claude for a new code |
| The code page says the authorization was not started in this browser | The poll came without the browser-binding cookie (another browser, or cookies blocked) | Start and finish the sign-in in the same browser with cookies allowed |
| The consent page says the request is invalid (400) | The client's registration was lost (KV cleared or a different stage) or the redirect does not match it | Remove the connector and add it again, so Claude registers anew |
| "This app could not be verified." | The client sent a Client ID Metadata Document URL, which this server does not enable | Use a client that supports Dynamic Client Registration (claude.ai, Desktop and Claude Code do) |
| Connected, but every tool call fails with an internal error | `API_TOKEN` is wrong or revoked, or the `API` Service Binding is broken. The api's 401 is a defect, not a tool result | Issue a new token with `POST /tokens`, update `STASH_MCP_API_TOKEN` and redeploy. Check `alchemy logs` for `Mcp` and `Api` |
| Tools disappear after about a month | The refresh token expired (30 days) | Reconnect: **Settings → Connectors → Stash → Connect**, or `/mcp` → **Authenticate** in Claude Code |
| A client gets `404` for its `Mcp-Session-Id` now and then | The Worker isolate was recycled and the older protocol revisions keep sessions in memory | Nothing to do: the client initializes again, as the spec requires. Revision `2026-07-28` is sessionless |
| `save_link` or `archive_tab` reports `RateLimited` | Saving is rate limited by the api | Wait and retry |
