import * as Link from "@stash/contracts-domain/link";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HtmlText from "./html-text.ts";
import * as XPostUrl from "@stash/backend-links/x-post-url";

// Pure readers of the two public sources of a post on X:
//
// - The syndication endpoint (`cdn.syndication.twimg.com/tweet-result`), the JSON behind embedded
//   posts: author, text with entities, media, the quoted post, counts.
// - oEmbed (`publish.twitter.com/oembed`), the fallback: the author and the text as a
//   `<blockquote>`, and nothing else.
//
// Both become the contract's `Link.Post`. The raw shapes are decoded loosely: a field X drops or
// adds must not lose the post.

const opt = <S extends Schema.Constraint>(schema: S) => Schema.optionalKey(Schema.NullOr(schema));

const Indices = Schema.Array(Schema.Number);

const RawEntities = Schema.Struct({
  urls: opt(
    Schema.Array(
      Schema.Struct({
        indices: Indices,
        display_url: opt(Schema.String),
        expanded_url: opt(Schema.String),
      }),
    ),
  ),
  user_mentions: opt(Schema.Array(Schema.Struct({ indices: Indices, screen_name: Schema.String }))),
  hashtags: opt(Schema.Array(Schema.Struct({ indices: Indices, text: Schema.String }))),
  symbols: opt(Schema.Array(Schema.Struct({ indices: Indices, text: Schema.String }))),
  media: opt(Schema.Array(Schema.Struct({ indices: Indices }))),
});

const RawMedia = Schema.Struct({
  type: Schema.String,
  media_url_https: Schema.String,
  original_info: opt(Schema.Struct({ width: opt(Schema.Number), height: opt(Schema.Number) })),
  video_info: opt(
    Schema.Struct({
      duration_millis: opt(Schema.Number),
      variants: opt(
        Schema.Array(
          Schema.Struct({
            bitrate: opt(Schema.Number),
            content_type: opt(Schema.String),
            url: Schema.String,
          }),
        ),
      ),
    }),
  ),
});

const rawFields = {
  id_str: Schema.String,
  text: Schema.String,
  display_text_range: opt(Indices),
  created_at: opt(Schema.String),
  lang: opt(Schema.String),
  favorite_count: opt(Schema.Number),
  conversation_count: opt(Schema.Number),
  user: Schema.Struct({
    name: opt(Schema.String),
    screen_name: Schema.String,
    profile_image_url_https: opt(Schema.String),
    is_blue_verified: opt(Schema.Boolean),
    verified: opt(Schema.Boolean),
  }),
  entities: opt(RawEntities),
  mediaDetails: opt(Schema.Array(RawMedia)),
  in_reply_to_screen_name: opt(Schema.String),
  note_tweet: opt(Schema.Unknown),
};

const RawQuoted = Schema.Struct(rawFields);
type RawQuoted = typeof RawQuoted.Type;

const RawPost = Schema.Struct({ ...rawFields, quoted_tweet: opt(RawQuoted) });

const RawOembed = Schema.Struct({
  author_name: opt(Schema.String),
  author_url: opt(Schema.String),
  html: Schema.String,
});

const decodeRawPost = Schema.decodeUnknownOption(RawPost);
const decodeRawOembed = Schema.decodeUnknownOption(RawOembed);
const decodePost = Schema.decodeUnknownOption(Link.Post);
const isUrl = Schema.is(Link.Url);
const isHandle = Schema.is(Link.PostHandle);

type EncodedPost = typeof Link.Post.Encoded;
type EncodedQuoted = typeof Link.QuotedPost.Encoded;
type EncodedEntity = typeof Link.PostEntity.Encoded;
type EncodedMedia = typeof Link.PostMedia.Encoded;

/** What a source said about a post. */
export type Parsed =
  /** The post, and the language X detected (an ISO 639-1 code), when it did. */
  | { readonly _tag: "Post"; readonly post: Link.Post; readonly language: Option.Option<string> }
  /** X says the post is gone: deleted, or its account is suspended or protected. */
  | { readonly _tag: "Gone" };

const parseJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

const count = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;

const size = (value: number | null | undefined): number | null => {
  const pixels = count(value);
  return pixels === null || pixels === 0 ? null : pixels;
};

/** An mp4 a browser plays without a wait: the best one under about 2.5 Mbit/s, else the smallest. */
export const maxVideoBitrate = 2_500_000;

type RawVariants = NonNullable<NonNullable<(typeof RawMedia.Type)["video_info"]>["variants"]>;

const videoUrl = (variants: RawVariants | null | undefined): string | null => {
  const mp4 = (variants ?? [])
    .filter((variant) => variant.content_type === "video/mp4" && isUrl(variant.url))
    .map((variant) => ({ url: variant.url, bitrate: variant.bitrate ?? 0 }))
    .sort((a, b) => a.bitrate - b.bitrate);
  const light = mp4.filter((variant) => variant.bitrate <= maxVideoBitrate);
  return (light.at(-1) ?? mp4[0])?.url ?? null;
};

const media = (raw: RawQuoted): Array<EncodedMedia> => {
  const result: Array<EncodedMedia> = [];
  for (const item of raw.mediaDetails ?? []) {
    if (!isUrl(item.media_url_https)) continue;
    const width = size(item.original_info?.width);
    const height = size(item.original_info?.height);
    if (item.type === "photo") {
      result.push({ kind: "photo", url: item.media_url_https, width, height });
    } else if (item.type === "video" || item.type === "animated_gif") {
      result.push({
        kind: item.type === "video" ? "video" : "gif",
        posterUrl: item.media_url_https,
        videoUrl: videoUrl(item.video_info?.variants),
        width,
        height,
        durationMs: count(item.video_info?.duration_millis),
      });
    }
  }
  return result;
};

interface Span {
  readonly start: number;
  readonly end: number;
  /** What the span shows. `""` drops it from the text. */
  readonly show: (written: string) => string;
  readonly kind?: EncodedEntity["kind"];
  readonly url?: string;
}

const span = (
  indices: ReadonlyArray<number>,
  rest: Omit<Span, "start" | "end">,
): ReadonlyArray<Span> => {
  const [start, end] = indices;
  return start === undefined || end === undefined || end <= start ? [] : [{ start, end, ...rest }];
};

const asWritten = (written: string) => written;

const spans = (raw: RawQuoted): ReadonlyArray<Span> => {
  const entities = raw.entities ?? {};
  return [
    ...(entities.urls ?? []).flatMap((url) =>
      span(url.indices, {
        show: (written) => url.display_url ?? url.expanded_url ?? written,
        kind: "link",
        ...(url.expanded_url == null ? {} : { url: url.expanded_url }),
      }),
    ),
    ...(entities.user_mentions ?? []).flatMap((mention) =>
      span(mention.indices, {
        show: asWritten,
        kind: "mention",
        url: `https://x.com/${mention.screen_name}`,
      }),
    ),
    ...(entities.hashtags ?? []).flatMap((hashtag) =>
      span(hashtag.indices, {
        show: asWritten,
        kind: "hashtag",
        url: `https://x.com/hashtag/${encodeURIComponent(hashtag.text)}`,
      }),
    ),
    ...(entities.symbols ?? []).flatMap((symbol) =>
      span(symbol.indices, {
        show: asWritten,
        kind: "cashtag",
        url: `https://x.com/search?q=${encodeURIComponent(`$${symbol.text}`)}`,
      }),
    ),
    // The link to the post's own media: the media are shown, not linked.
    ...(entities.media ?? []).flatMap((item) => span(item.indices, { show: () => "" })),
  ].sort((a, b) => a.start - b.start);
};

/**
 * The post's text as displayed, with its entities. X's indices count code points and its text is
 * HTML-escaped; the result is plain text with UTF-16 offsets. Outside `display_text_range` are the
 * handles a reply starts with and the link to the post's media.
 */
const textAndEntities = (
  raw: RawQuoted,
): { readonly text: string; readonly entities: Array<EncodedEntity> } => {
  const points = Array.from(raw.text);
  const [from = 0, to = points.length] = raw.display_text_range ?? [];
  const slice = (start: number, end: number) => points.slice(start, end).join("");
  const entities: Array<EncodedEntity> = [];
  let text = "";
  let at = Math.max(0, from);
  const limit = Math.min(points.length, Math.max(to, at));
  for (const part of spans(raw)) {
    if (part.start < at || part.end > limit) continue;
    text += HtmlText.decodeEntities(slice(at, part.start));
    const shown = part.show(slice(part.start, part.end));
    if (part.kind !== undefined && part.url !== undefined && shown !== "" && isUrl(part.url)) {
      entities.push({
        kind: part.kind,
        start: text.length,
        end: text.length + shown.length,
        url: part.url,
      });
    }
    text += shown;
    at = part.end;
  }
  text += HtmlText.decodeEntities(slice(at, limit));
  return { text: text.trimEnd(), entities };
};

const isoDate = (value: string | null | undefined): string | null => {
  const millis = value == null ? Number.NaN : Date.parse(value);
  return Number.isNaN(millis) ? null : new Date(millis).toISOString();
};

const fields = (raw: RawQuoted): EncodedQuoted => {
  const likes = count(raw.favorite_count);
  const replies = count(raw.conversation_count);
  const avatar = raw.user.profile_image_url_https;
  const replyTo = raw.in_reply_to_screen_name;
  return {
    id: raw.id_str,
    url: XPostUrl.postUrl(raw.user.screen_name, raw.id_str),
    author: {
      name: (raw.user.name ?? "").trim() || raw.user.screen_name,
      handle: raw.user.screen_name,
      avatarUrl: avatar != null && isUrl(avatar) ? avatar : null,
      verified: raw.user.is_blue_verified === true || raw.user.verified === true,
    },
    ...textAndEntities(raw),
    createdAt: isoDate(raw.created_at),
    media: media(raw),
    replyTo: replyTo != null && isHandle(replyTo) ? replyTo : null,
    counts: likes === null && replies === null ? null : { likes, replies },
    long: raw.note_tweet != null,
  };
};

/** Codes X uses for "no language": undetermined, no text, only links, hashtags or mentions. */
const noLanguage: ReadonlySet<string> = new Set(["und", "zxx", "qme", "qht", "qst", "qam", "qct"]);

const language = (lang: string | null | undefined): Option.Option<string> =>
  Option.fromNullishOr(lang).pipe(
    Option.map((code) => code.toLowerCase()),
    Option.filter((code) => /^[a-z]{2}$/.test(code) && !noLanguage.has(code)),
  );

/**
 * Reads a syndication response. `None` when the body is not a post the reader understands (an
 * error page, an empty object, a new shape), so the caller asks oEmbed.
 */
export const parseSyndication = (body: string): Option.Option<Parsed> => {
  const json = parseJson(body);
  if (typeof json !== "object" || json === null) return Option.none();
  if ("tombstone" in json || ("__typename" in json && json.__typename === "TweetTombstone")) {
    return Option.some({ _tag: "Gone" });
  }
  return decodeRawPost(json).pipe(
    Option.flatMap((raw) => {
      const quoted = raw.quoted_tweet;
      const encoded: EncodedPost = {
        state: "available",
        ...fields(raw),
        quoted: quoted == null ? null : fields(quoted),
      };
      return Option.map(decodePost(encoded), (post): Parsed => ({
        _tag: "Post",
        post,
        language: language(raw.lang),
      }));
    }),
  );
};

/** The first day ids were snowflakes; older ids hold no time. */
const snowflakeEpoch = 1_288_834_974_657n;

/** When a post was made, from its id: a snowflake id starts with its millisecond. */
export const createdAtFromId = (id: string): string | null => {
  if (!/^\d{15,25}$/.test(id)) return null;
  const millis = Number((BigInt(id) >> 22n) + snowflakeEpoch);
  return Number.isSafeInteger(millis) && millis < 8.64e15 ? new Date(millis).toISOString() : null;
};

const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const plain = (html: string): string =>
  HtmlText.decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""));

/** The `<p>` of an oEmbed blockquote as text with entities. */
const blockquoteText = (
  html: string,
): { readonly text: string; readonly entities: Array<EncodedEntity> } => {
  const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? "";
  const entities: Array<EncodedEntity> = [];
  let text = "";
  let at = 0;
  for (const match of paragraph.matchAll(anchor)) {
    text += plain(paragraph.slice(at, match.index));
    at = match.index + match[0].length;
    const shown = plain(match[2] ?? "");
    // The link to the post's media, which oEmbed does not describe.
    if (/^pic\.(twitter|x)\.com\//.test(shown)) continue;
    const href = HtmlText.parseAttributes(`<a ${match[1] ?? ""}>`)["href"] ?? "";
    const name = shown.slice(1);
    const [kind, url]: [EncodedEntity["kind"], string] = shown.startsWith("@")
      ? ["mention", `https://x.com/${name}`]
      : shown.startsWith("#")
        ? ["hashtag", `https://x.com/hashtag/${encodeURIComponent(name)}`]
        : shown.startsWith("$")
          ? ["cashtag", `https://x.com/search?q=${encodeURIComponent(shown)}`]
          : ["link", href];
    if (shown !== "" && isUrl(url)) {
      entities.push({ kind, start: text.length, end: text.length + shown.length, url });
    }
    text += shown;
  }
  text += plain(paragraph.slice(at));
  return { text: text.trimEnd(), entities };
};

/**
 * Reads an oEmbed response for the post `target`: the author and the text, with no avatar, media,
 * quote or counts. `None` when the body is not oEmbed JSON with a handle.
 */
export const parseOembed = (body: string, target: XPostUrl.Target): Option.Option<Link.Post> =>
  decodeRawOembed(parseJson(body)).pipe(
    Option.flatMap((raw) => {
      const fromUrl =
        raw.author_url != null && URL.canParse(raw.author_url)
          ? new URL(raw.author_url).pathname.split("/")[1]
          : undefined;
      const handle = fromUrl ?? target.handle;
      if (!isHandle(handle) || handle === "i") return Option.none();
      const encoded: EncodedPost = {
        state: "available",
        id: target.id,
        url: XPostUrl.postUrl(handle, target.id),
        author: {
          name: (raw.author_name ?? "").trim() || handle,
          handle,
          avatarUrl: null,
          verified: false,
        },
        ...blockquoteText(raw.html),
        createdAt: createdAtFromId(target.id),
        media: [],
        replyTo: null,
        counts: null,
        long: false,
        quoted: null,
      };
      return decodePost(encoded);
    }),
  );
