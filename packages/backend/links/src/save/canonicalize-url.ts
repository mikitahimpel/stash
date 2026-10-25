import * as Link from "@stash/contracts-domain/link";

// The canonical URL is the dedupe key (`links.canonical_url` is unique). The link keeps the URL it
// was saved with, so canonicalization may drop anything that does not change what the page is.

/** Query parameters that only track where a click came from. Matched case-insensitively. */
const trackingParams = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "twclid",
  "ttclid",
  "li_fat_id",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "_ga",
  "_gl",
  "mkt_tok",
  "oly_anon_id",
  "oly_enc_id",
  "rb_clickid",
  "vero_id",
  "wickedid",
  "ref_src",
  "ref_url",
]);

const isTrackingParam = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || trackingParams.has(lower);
};

const youtubeHosts = new Set(["youtube.com", "m.youtube.com", "music.youtube.com"]);

/** A YouTube video id from a short or alternative URL form, if this is one. */
const youtubeVideoId = (url: URL): string | undefined => {
  if (url.hostname === "youtu.be") return url.pathname.split("/")[1] || undefined;
  if (!youtubeHosts.has(url.hostname)) return undefined;
  if (url.pathname === "/watch") return url.searchParams.get("v") || undefined;
  const [, kind, id] = url.pathname.split("/");
  return kind === "shorts" || kind === "embed" || kind === "live" || kind === "v"
    ? id || undefined
    : undefined;
};

/** Hash routes (`#/path`, `#!/path`) address a page in a single-page app. Other fragments don't. */
const isRouteFragment = (hash: string): boolean => hash.startsWith("#/") || hash.startsWith("#!");

/**
 * The canonical form of a URL:
 * - lowercase scheme and host, no `www.`, no default port;
 * - no tracking parameters (`utm_*`, `fbclid`, …), remaining parameters sorted by name;
 * - no trailing slash on a non-root path, no fragment unless it is a hash route;
 * - YouTube videos (`youtu.be/<id>`, `/shorts/<id>`, `/embed/<id>`, `m.youtube.com`) as
 *   `https://youtube.com/watch?v=<id>`.
 */
export const canonicalize = (input: Link.Url): Link.Url => {
  const url = new URL(input);
  url.hostname = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");

  const videoId = youtubeVideoId(url);
  if (videoId !== undefined) {
    return Link.Url.make(`https://youtube.com/watch?v=${encodeURIComponent(videoId)}`);
  }

  const params = [...url.searchParams].filter(([name]) => !isTrackingParam(name));
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = new URLSearchParams(params).toString();

  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (!isRouteFragment(url.hash)) url.hash = "";

  return Link.Url.make(url.toString());
};
