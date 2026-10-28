import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

// The server-rendered sign-in pages: consent, then the GitHub device code. Minimal "Stash tactile"
// (docs/design.md): dark or light from `prefers-color-scheme`, labels and data only.

export const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const styles = `:root{color-scheme:dark light;--bg:#f7f7f8;--fg:#111113;--muted:#6b6b70;--line:#e4e4e7;--sunken:#efeff1;--sunken-line:#d4d4d8;--danger:#c42b2b}
@media (prefers-color-scheme:dark){:root{--bg:#0c0c0d;--fg:#ededed;--muted:#8f8f8f;--line:#1f1f21;--sunken:#09090a;--sunken-line:#1c1c1e;--danger:#ff6b6b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 Geist,ui-sans-serif,system-ui,sans-serif}
main{max-width:420px;margin:12vh auto;padding:0 16px}
.mark{font:500 12px "Geist Mono",ui-monospace,monospace;color:var(--muted);margin:0 0 24px}
h1{font-size:14px;font-weight:500;margin:0 0 8px}
p{margin:0 0 16px}
.muted{color:var(--muted)}
.mono{font-family:"Geist Mono",ui-monospace,monospace;font-size:12px}
.code{font:500 28px/1 "Geist Mono",ui-monospace,monospace;letter-spacing:.12em;text-align:center;padding:18px 0;border-radius:10px;background:var(--sunken);border:1px solid var(--sunken-line);box-shadow:inset 0 1px 3px rgba(0,0,0,.12);user-select:all}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.button{display:inline-flex;align-items:center;min-height:34px;padding:0 14px;border-radius:8px;font:500 13px inherit;font-family:inherit;text-decoration:none;cursor:pointer;background:linear-gradient(180deg,#fff 0%,#f3f3f4 100%);border:1px solid #d4d4d8;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 1px 1px rgba(0,0,0,.08),0 2px 4px rgba(0,0,0,.06);color:#111113}
.button:active{transform:translateY(.5px)}
.primary{background:linear-gradient(180deg,#2a2a2d 0%,#161618 100%);border-color:#0b0b0c;box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 1px 1px rgba(0,0,0,.1),0 2px 6px rgba(0,0,0,.1);color:#fff}
@media (prefers-color-scheme:dark){
.button{background:linear-gradient(180deg,#262629 0%,#1d1d1f 100%);border-color:#080809;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),inset 0 -1px 0 rgba(0,0,0,.3),0 1px 1px rgba(0,0,0,.5),0 2px 4px rgba(0,0,0,.2);color:#ededed}
.primary{background:linear-gradient(180deg,#f6f6f6 0%,#dbdbdb 100%);border-color:#808080;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),inset 0 -1px 0 #c2c2c2,0 1px 1px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.25);color:#111}}
.button:focus-visible,a:focus-visible{outline:2px solid color-mix(in srgb,var(--fg) 40%,transparent);outline-offset:2px}
a{color:inherit;text-decoration-color:var(--line);text-underline-offset:4px}
a:hover{text-decoration-color:currentColor}
.error{color:var(--danger)}`;

const page = (title: string, body: string, nonce?: string) => {
  const attr = nonce === undefined ? "" : ` nonce="${nonce}"`;
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escape(title)}</title>
<style${attr}>${styles}</style>
<main>
<p class="mark">stash</p>
${body}
</main>
</html>`;
};

export const consent = (details: ConsentDescription, handle: string) => {
  const name = escape(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : "Unverified app name.";
  const loopback = details.redirectIsLoopback
    ? "<p><strong>Access goes to an app on this computer.</strong> Continue only if you just started signing in from it.</p>"
    : "";
  return page(
    `Authorize ${details.clientName}`,
    `<h1>Allow ${name} to use your Stash?</h1>
<p class="muted">${origin} Access goes to <span class="mono">${escape(details.redirectHost)}</span>.</p>
${loopback}
<form method="post" class="actions">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <button class="button primary" name="decision" value="approve">Continue with GitHub</button>
  <button class="button" name="decision" value="deny">Deny</button>
</form>`,
  );
};

export interface Device {
  readonly state: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly interval: number;
  readonly pollPath: string;
}

// Polls `pollPath` with the upstream `state` (the binding cookie rides along). `pending` and
// `slow_down` carry the interval to wait; `complete` carries the client redirect; anything else is
// a final error with a message and, when the client may be told, its error redirect.
const pollScript = `const flow = document.getElementById("flow").dataset;
const status = document.getElementById("status");
const back = document.getElementById("back");
let wait = Number(flow.interval) * 1000;
document.getElementById("copy").addEventListener("click", () => {
  navigator.clipboard?.writeText(flow.code).catch(() => {});
});
const tick = async () => {
  let body;
  try {
    const response = await fetch(flow.poll, { method: "POST", body: new URLSearchParams({ state: flow.state }) });
    body = await response.json();
  } catch {
    setTimeout(tick, wait);
    return;
  }
  if (body.status === "pending" || body.status === "slow_down") {
    wait = body.interval * 1000;
    setTimeout(tick, wait);
    return;
  }
  if (body.status === "complete") {
    status.textContent = "Signed in. Returning to the app…";
    location.assign(body.redirectTo);
    return;
  }
  status.textContent = body.message;
  status.className = "error";
  if (body.redirectTo) {
    back.href = body.redirectTo;
    back.hidden = false;
  }
};
setTimeout(tick, wait);`;

export const device = (flow: Device, nonce: string) =>
  page(
    "Sign in with GitHub",
    `<div id="flow" data-state="${escape(flow.state)}" data-code="${escape(flow.userCode)}" data-interval="${flow.interval}" data-poll="${escape(flow.pollPath)}" hidden></div>
<h1>Sign in with GitHub</h1>
<p class="muted">Enter this code at <a href="${escape(flow.verificationUri)}" target="_blank" rel="noopener noreferrer" class="mono">${escape(flow.verificationUri.replace(/^https:\/\//, ""))}</a>.</p>
<p class="code" id="user-code">${escape(flow.userCode)}</p>
<p class="actions">
  <a class="button primary" href="${escape(flow.verificationUri)}" target="_blank" rel="noopener noreferrer">Open GitHub</a>
  <button class="button" type="button" id="copy">Copy code</button>
</p>
<p id="status" role="status" class="muted">Waiting for GitHub…</p>
<p><a id="back" class="button" hidden>Back to the app</a></p>
<script nonce="${nonce}">${pollScript}</script>`,
    nonce,
  );
