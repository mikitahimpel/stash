// What a generated cover needs to know about a site: its host, where its icon lives, and a hue of
// its own. All of it is derived from the link's or tab's URL, with no request.

/** The url's host without `www.`, or `""` for something that is not a web page. */
export const host = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.hostname.replace(/^www\./, "")
      : "";
  } catch {
    return "";
  }
};

/**
 * Where a site keeps its icon by convention: `/favicon.ico` on the page's own origin. `null` for
 * a url that is not http(s). A site without one there shows its initial instead.
 */
export const favicon = (url: string): string | null => {
  try {
    const { protocol, host } = new URL(url);
    return (protocol === "https:" || protocol === "http:") && host !== ""
      ? `${protocol}//${host}/favicon.ico`
      : null;
  } catch {
    return null;
  }
};

/** A hue (0–359) for a host: always the same for the same host, spread over the wheel (FNV-1a). */
export const hue = (host: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < host.length; i++) {
    hash ^= host.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 360;
};
