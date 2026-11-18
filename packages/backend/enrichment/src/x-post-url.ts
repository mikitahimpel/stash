import * as Option from "effect/Option";

// Links to posts on X, in every form they are shared in: x.com, the old twitter.com, the mobile
// hosts, and the embed-fixing mirrors people paste into chats.

const hosts: ReadonlySet<string> = new Set([
  "x.com",
  "twitter.com",
  "mobile.x.com",
  "mobile.twitter.com",
  "fxtwitter.com",
  "vxtwitter.com",
  "fixupx.com",
  "fixvx.com",
]);

/** A post on X: its status id and the handle the URL names (`i` when it names none). */
export interface Target {
  readonly handle: string;
  readonly id: string;
}

const host = (url: string): Option.Option<URL> => {
  if (!URL.canParse(url)) return Option.none();
  const parsed = new URL(url);
  return hosts.has(parsed.hostname.toLowerCase().replace(/^www\./, ""))
    ? Option.some(parsed)
    : Option.none();
};

/** Whether the URL is on X or one of its mirrors: a page that is never fetched as HTML. */
export const isXHost = (url: string): boolean => Option.isSome(host(url));

const statusPath = /^\/(?:([A-Za-z0-9_]{1,30})|i\/web)\/status(?:es)?\/(\d{1,25})(?:\/|$)/;

/** The post a URL points at, if it is a status URL (`/<handle>/status/<id>`, `/i/web/status/<id>`). */
export const target = (url: string): Option.Option<Target> =>
  host(url).pipe(
    Option.flatMapNullishOr((parsed) => statusPath.exec(parsed.pathname)),
    Option.flatMap(([, handle, id]) =>
      id === undefined ? Option.none() : Option.some({ handle: handle ?? "i", id }),
    ),
  );

/** The post's address on X, with the handle as given. */
export const postUrl = (handle: string, id: string): string =>
  `https://x.com/${handle}/status/${id}`;

/** The dedupe form of a post's address: handles don't differ by case. */
export const canonicalUrl = (target: Target): string =>
  postUrl(target.handle.toLowerCase(), target.id);
