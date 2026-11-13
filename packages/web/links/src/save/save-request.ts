import * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import * as Schema from "effect/Schema";

// The `/save` route: `/save?device=<id>&title=<title>&url=<url>`. An Apple Shortcut, a bookmarklet
// or any other app opens it with the link to save, and the signed-in session saves it.
//
// `url` comes last and takes the rest of the address, `#` included. A Shortcut pastes the shared
// URL raw (`…&url=https://example.com/a?b=1&c=2#top`), and only the rest of the address keeps such
// a URL whole. A percent-encoded `url` (the bookmarklet's) is decoded. Parameters before `url` are
// ordinary query parameters.

/** What `/save` was asked to save. */
export interface SaveRequest {
  readonly url: Link.Url;
  readonly title?: string;
  readonly deviceId?: Device.DeviceId;
}

const isUrl = Schema.is(Link.Url);
const isTitle = Schema.is(Link.LinkTitle);
const isDeviceId = Schema.is(Device.DeviceId);

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
};

/** The URL from the raw rest of the address: as given when it reads as one, else decoded. */
const readUrl = (raw: string): Link.Url | undefined => {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed) && isUrl(trimmed)) return trimmed;
  try {
    const decoded = decodeURIComponent(trimmed).trim();
    return isUrl(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Reads a `/save` address (a route's `fullPath`, `/save?…`). `undefined` when it names no http(s)
 * URL. A title or device that doesn't validate is left out rather than failing the save.
 */
export const parse = (fullPath: string): SaveRequest | undefined => {
  const queryStart = fullPath.indexOf("?");
  if (queryStart === -1) return undefined;
  const query = fullPath.slice(queryStart + 1);
  const match = /(?:^|&)url=/.exec(query);
  if (match === null) return undefined;
  const url = readUrl(query.slice(match.index + match[0].length));
  if (url === undefined) return undefined;
  const params = new Map<string, string>();
  for (const pair of query.slice(0, match.index).split("&")) {
    const at = pair.indexOf("=");
    if (at > 0) params.set(decode(pair.slice(0, at)), decode(pair.slice(at + 1)));
  }
  const title = params.get("title")?.trim();
  const deviceId = params.get("device")?.trim();
  return {
    url,
    ...(title !== undefined && isTitle(title) ? { title } : {}),
    ...(deviceId !== undefined && isDeviceId(deviceId) ? { deviceId } : {}),
  };
};

/**
 * The `/save` address for `origin`, for guides and the bookmarklet. With `url` left out it ends in
 * `url=`, ready for the link to be appended.
 */
export const address = (
  origin: string,
  fields: { readonly deviceId?: string; readonly title?: string; readonly url?: string } = {},
): string => {
  const params = [
    ...(fields.deviceId === undefined ? [] : [`device=${encodeURIComponent(fields.deviceId)}`]),
    ...(fields.title === undefined ? [] : [`title=${encodeURIComponent(fields.title)}`]),
    `url=${fields.url === undefined ? "" : encodeURIComponent(fields.url)}`,
  ];
  return `${origin}/save?${params.join("&")}`;
};
