// The values each guide prefills, from the live deploy: this web app's origin, the MCP endpoint and
// a freshly created token. Each one has a Copy button next to it.

/** `'…'` for a POSIX shell. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * The URL the iPhone Shortcut opens, with the Shortcut Input appended after `url=`. Opening it in
 * Safari saves the link with the browser's session, attributed to the iPhone's device. `url` comes
 * last: the web `/save` route takes the rest of the address as the link.
 */
export const shortcutUrl = (origin: string, deviceId: string): string =>
  `${origin}/save?device=${encodeURIComponent(deviceId)}&url=`;

/** A bookmarklet that opens `/save` with the current page, for any browser. */
export const bookmarklet = (origin: string): string =>
  `javascript:(()=>{location.href=${JSON.stringify(`${origin}/save?title=`)}` +
  `+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)})()`;

/** Where the token-based (advanced) Shortcut posts, same-origin under `/api`. */
export const saveLinkEndpoint = (origin: string): string => `${origin}/api/links`;

/** The `Authorization` header value of the advanced Shortcut. */
export const bearer = (token: string): string => `Bearer ${token}`;

/** The extension package the web app serves (see `apps/extension/scripts/package-xpi.ts`). */
export const extensionDownload = (origin: string): string =>
  `${origin}/downloads/stash-extension.xpi`;

/** The one command that installs and starts the Mac agent, with the address and token in it. */
export const macInstallCommand = (origin: string, token: string): string =>
  `curl -fsSL ${shellQuote(`${origin}/downloads/install-mac-agent.sh`)} | ` +
  `STASH_URL=${shellQuote(origin)} STASH_DEVICE_TOKEN=${shellQuote(token)} bash`;

/**
 * The same install without the token in the command: the installer asks for it in the terminal,
 * hidden (`read -rs`), so it stays out of the shell history.
 */
export const macInstallCommandPrompt = (origin: string): string =>
  `curl -fsSL ${shellQuote(`${origin}/downloads/install-mac-agent.sh`)} | ` +
  `STASH_URL=${shellQuote(origin)} bash`;

/** The command that stops the Mac agent and removes it. */
export const macUninstallCommand = (origin: string): string =>
  `curl -fsSL ${shellQuote(`${origin}/downloads/install-mac-agent.sh`)} | bash -s -- --uninstall`;
