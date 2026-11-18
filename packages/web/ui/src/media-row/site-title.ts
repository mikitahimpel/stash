// A page title as a row shows it: without the site's own name before or after it
// (`GitHub - owner/repo: …`, `… · GitHub`, `… | Example`). The row names the site in its meta
// line and on its cover, so the name in the title only pushes the words that matter out of the
// one line a row has. Display only: the stored title is never changed.

/** Second-level labels that are part of a public suffix: `example.co.uk`, `example.com.au`. */
const suffixLabels = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const plain = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// An address, not a name: `192.0.2.1`, `[2001:db8::1]` (a URL's hostname is already normalized).
const ip = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[.*\])$/;

/**
 * The names a site goes by in a title: `github` and `github.com` for `docs.github.com`. None for
 * an IP host, whose labels are numbers and not a name.
 */
const names = (host: string): ReadonlySet<string> => {
  if (ip.test(host)) return new Set();
  const labels = host.split(".").filter((label) => label !== "");
  if (labels.length < 2) return new Set();
  const last = labels.at(-1)!;
  const suffix = labels.length > 2 && last.length === 2 && suffixLabels.has(labels.at(-2)!) ? 2 : 1;
  const site = labels.slice(0, -suffix).at(-1)!;
  return new Set([site, labels.slice(-suffix - 1).join("."), host].map(plain));
};

// A name is set off by a dash, a bar or a dot with a space on both sides.
const leading = /^(.+?)\s+[-–—|·•]\s+(.+)$/su;
const trailing = /^(.+)\s+[-–—|·•]\s+(.+?)$/su;

/**
 * `title` without the site name of `url` at its start or end. A part is the site's name when it
 * equals the host's own label (`github` for `github.com`) or the host, whatever the case, spaces
 * or punctuation (`Eleven Labs` for `elevenlabs.io`). A title that is nothing but the name stays.
 */
export const strip = (title: string, url: string): string => {
  const site = names(hostOf(url));
  if (site.size === 0) return title;
  let rest = title.trim();
  const head = leading.exec(rest);
  if (head !== null && site.has(plain(head[1]!))) rest = head[2]!.trim();
  const tail = trailing.exec(rest);
  if (tail !== null && site.has(plain(tail[2]!))) rest = tail[1]!.trim();
  return rest === "" ? title : rest;
};
