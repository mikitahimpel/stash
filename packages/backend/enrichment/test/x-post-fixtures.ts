// Synthetic answers of X's public endpoints, in the shape the real ones have (checked against
// real public posts; nothing here is one). Handles, names, ids and texts are invented, and the
// media URLs only look like X's.

export const postId = "1700000000000000001";
export const handle = "example_writer";

const user = {
  id_str: "1000000000000000001",
  name: "Example Writer",
  screen_name: handle,
  is_blue_verified: true,
  profile_image_shape: "Circle",
  verified: false,
  profile_image_url_https:
    "https://pbs.twimg.com/profile_images/1000000000000000001/synthetic_normal.jpg",
};

const base = {
  __typename: "Tweet",
  favorite_count: 1234,
  lang: "en",
  created_at: "2026-01-02T03:04:05.000Z",
  id_str: postId,
  user,
  edit_control: { edit_tweet_ids: [postId], is_edit_eligible: true },
  conversation_count: 56,
  news_action_type: "conversation",
  isEdited: false,
  isStaleEdit: false,
};

/** Code-point indices of `part` in `text`, the way X counts them. */
const indices = (text: string, part: string): [number, number] => {
  const start = Array.from(text.slice(0, text.indexOf(part))).length;
  return [start, start + Array.from(part).length];
};

const plainText =
  "An example post 🙂 about parsers &amp; tools, see https://t.co/synthetic1 by @example_reader #parsing $EXMPL";

/** A text-only post with a link, a mention, a hashtag and a cashtag, after an emoji. */
export const textPost = JSON.stringify({
  ...base,
  display_text_range: [0, Array.from(plainText).length],
  text: plainText,
  entities: {
    hashtags: [{ indices: indices(plainText, "#parsing"), text: "parsing" }],
    urls: [
      {
        display_url: "example.com/parsers",
        expanded_url: "https://example.com/parsers?from=post",
        indices: indices(plainText, "https://t.co/synthetic1"),
        url: "https://t.co/synthetic1",
      },
    ],
    user_mentions: [
      {
        id_str: "1000000000000000002",
        indices: indices(plainText, "@example_reader"),
        name: "Example Reader",
        screen_name: "example_reader",
      },
    ],
    symbols: [{ indices: indices(plainText, "$EXMPL"), text: "EXMPL" }],
  },
});

const photo = (n: number) => ({
  display_url: "pic.x.com/synthetic",
  expanded_url: `https://x.com/${handle}/status/${postId}/photo/${n}`,
  ext_media_availability: { status: "Available" },
  indices: [24, 47],
  media_url_https: `https://pbs.twimg.com/media/Synthetic${n}.jpg`,
  original_info: { focus_rects: [], height: 800, width: 1200 },
  sizes: {},
  type: "photo",
  url: "https://t.co/syntheticm",
});

const photosText = "Example photos, in a row https://t.co/syntheticm";

/** A post with `count` photos. The link to them is outside the displayed text. */
export const photoPost = (count: number) =>
  JSON.stringify({
    ...base,
    display_text_range: [0, 24],
    text: photosText,
    entities: {
      media: [
        { display_url: "pic.x.com/synthetic", indices: [25, 48], url: "https://t.co/syntheticm" },
      ],
    },
    mediaDetails: Array.from({ length: count }, (_, i) => photo(i + 1)),
    photos: [],
  });

const video = "https://video.twimg.com/ext_tw_video/1700000000000000002/pu/vid";

/** A post with a video: an HLS playlist and four mp4s. */
export const videoPost = JSON.stringify({
  ...base,
  display_text_range: [0, 16],
  text: "An example video https://t.co/syntheticv",
  entities: { media: [{ indices: [17, 40], url: "https://t.co/syntheticv" }] },
  mediaDetails: [
    {
      indices: [17, 40],
      media_url_https:
        "https://pbs.twimg.com/ext_tw_video_thumb/1700000000000000002/pu/img/synthetic.jpg",
      original_info: { focus_rects: [], height: 1080, width: 1920 },
      type: "video",
      video_info: {
        aspect_ratio: [16, 9],
        duration_millis: 42_000,
        variants: [
          { content_type: "application/x-mpegURL", url: `${video}/pl/synthetic.m3u8` },
          { bitrate: 256_000, content_type: "video/mp4", url: `${video}/480x270/a.mp4?tag=12` },
          { bitrate: 832_000, content_type: "video/mp4", url: `${video}/640x360/b.mp4?tag=12` },
          { bitrate: 2_176_000, content_type: "video/mp4", url: `${video}/1280x720/c.mp4?tag=12` },
          {
            bitrate: 10_368_000,
            content_type: "video/mp4",
            url: `${video}/1920x1080/d.mp4?tag=12`,
          },
        ],
      },
    },
  ],
});

/** A reply that quotes another post: the handles it answers are outside the displayed text. */
export const quotePost = JSON.stringify({
  ...base,
  display_text_range: [16, 42],
  text: "@example_reader I agree with this example.",
  entities: {
    user_mentions: [{ indices: [0, 15], name: "Example Reader", screen_name: "example_reader" }],
  },
  in_reply_to_screen_name: "example_reader",
  in_reply_to_status_id_str: "1700000000000000003",
  quoted_tweet: {
    ...base,
    id_str: "1700000000000000004",
    favorite_count: 7,
    conversation_count: undefined,
    display_text_range: [0, 31],
    text: "The quoted example, in one line",
    entities: {},
    user: {
      ...user,
      name: "Example Quoted",
      screen_name: "example_quoted",
      is_blue_verified: false,
    },
  },
});

const longText = `${"An example sentence about tiny parsers. ".repeat(7)}…`;

/** A long post ("note"): syndication gives its beginning and marks it. */
export const longPost = JSON.stringify({
  ...base,
  display_text_range: [0, Array.from(longText).length],
  text: longText,
  entities: {},
  note_tweet: { id: "Tm90ZVR3ZWV0OjE3MDAwMDAwMDAwMDAwMDAwMDU=" },
});

/** What syndication answers for a deleted post. */
export const tombstone = JSON.stringify({
  __typename: "TweetTombstone",
  tombstone: {
    text: {
      entities: [],
      rtl: false,
      text: "This Post was deleted by the Post author. Learn more",
    },
  },
});

/** What syndication answers with a 404: X's HTML error page. */
export const notFoundPage = `<!DOCTYPE html><html lang="en"><head><title>X / ?</title></head><body></body></html>`;

/** oEmbed for the same post: the author and a blockquote. */
export const oembed = JSON.stringify({
  url: `https://x.com/${handle}/status/${postId}`,
  author_name: "Example Writer",
  author_url: `https://x.com/${handle}`,
  html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">An example post about parsers &amp; tools<br>see <a href="https://t.co/synthetic1">example.com/parsers</a> by <a href="https://twitter.com/example_reader?ref_src=twsrc%5Etfw">@example_reader</a> <a href="https://twitter.com/hashtag/parsing?src=hash&amp;ref_src=twsrc%5Etfw">#parsing</a> <a href="https://t.co/syntheticm">pic.twitter.com/synthetic</a></p>&mdash; Example Writer (@${handle}) <a href="https://x.com/${handle}/status/${postId}?ref_src=twsrc%5Etfw">January 2, 2026</a></blockquote>\n`,
  width: 550,
  type: "rich",
  provider_name: "X",
  version: "1.0",
});
