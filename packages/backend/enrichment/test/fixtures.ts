// Synthetic pages, invented for these tests. None of them is a copy of a real page.

export const articlePage = `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <title>  Building a Tiny Parser &amp; Why It Works </title>
  <meta name="description" content="A walk through a small HTML parser.">
  <meta property="og:description" content="Ignored, the plain description wins.">
  <style>body { color: red; }</style>
  <script>window.tracking = "should not appear";</script>
</head>
<body>
  <nav><a href="/">Home</a> <a href="/about">About</a></nav>
  <header><p>Site banner</p></header>
  <!-- a comment that should not appear -->
  <aside class="teaser"><article><p>Short teaser</p></article></aside>
  <article>
    <h1>Building a Tiny Parser</h1>
    <p>The parser reads the page and keeps only the text that matters.
       It is small, and it is fast enough for the job.</p>
    <p>It turns <em>inline</em> tags into spaces &mdash; and blocks into lines.</p>
    <ul><li>First point</li><li>Second&nbsp;point &#x2713;</li></ul>
    <script>console.log("inline script")</script>
  </article>
  <footer>Copyright &copy; Example</footer>
</body>
</html>`;

export const germanPage = `<html lang="en"><head><title>Ein Beispiel</title>
<meta property="og:title" content="unused"></head>
<body><main><p>Das ist ein Beispiel für eine Seite, die nicht auf Englisch ist. Der Text ist
auf Deutsch, und die Sprache sollte auch so erkannt werden, auch wenn das Attribut falsch ist.</p>
</main></body></html>`;

export const ogOnlyPage = `<html><head>
<meta content='Only Open Graph' property='og:title'>
<meta name="twitter:description" content="From the twitter card.">
</head><body><div>Body text without a main region.</div></body></html>`;

export const videoId = "AbCdEfGhIjK";

const playerResponse = (captionTracks: ReadonlyArray<object> | undefined) =>
  JSON.stringify({
    videoDetails: {
      videoId,
      title: "A Synthetic Video {with braces}",
      shortDescription: 'Description of the video, with "quotes" and } braces.',
    },
    microformat: { playerMicroformatRenderer: { defaultAudioLanguage: "en" } },
    ...(captionTracks === undefined
      ? {}
      : { captions: { playerCaptionsTracklistRenderer: { captionTracks } } }),
  });

export const captionsBase = "https://www.youtube.com/api/timedtext";

export const watchPage = (captionTracks?: ReadonlyArray<object>) => `<!doctype html>
<html><head><title>A Synthetic Video - YouTube</title></head><body>
<script>var ytInitialPlayerResponse = ${playerResponse(captionTracks)};var meta = {};</script>
</body></html>`;

export const tracks = [
  { baseUrl: `${captionsBase}?v=${videoId}&lang=de`, languageCode: "de" },
  { baseUrl: `${captionsBase}?v=${videoId}&lang=en&kind=asr`, languageCode: "en", kind: "asr" },
  { baseUrl: `${captionsBase}?v=${videoId}&lang=en`, languageCode: "en" },
];

export const timedTextV1 = `<?xml version="1.0" encoding="utf-8" ?><transcript>
<text start="0.0" dur="2.1">Hello and welcome to this video.</text>
<text start="2.1" dur="3.0">Today we&amp;#39;ll talk about parsers &amp;amp; text.</text>
<text start="5.1" dur="1.0">   </text>
</transcript>`;

export const timedTextV3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>
<p t="0" d="2100"><s>Hello</s><s> there</s></p>
<p t="2100" d="1000">Second cue</p>
</body></timedtext>`;

// What YouTube answers a data-center address in place of a watch page: a 200 with a consent form
// and no video. Its `<title>` is the bare site name.
export const consentPage = `<!doctype html>
<html lang="en"><head><title> - YouTube</title>
<meta property="og:image" content="https://www.youtube.com/img/desktop/yt_1200.png"></head>
<body><form action="https://consent.youtube.com/save" method="POST">
<h1>Before you continue to YouTube</h1>
<p>We use cookies and data to deliver and maintain our services.</p>
<button>Reject all</button><button>Accept all</button></form></body></html>`;

// The bot check: a player response, but with no video in it.
export const botCheckPage = `<!doctype html>
<html><head><title> - YouTube</title></head><body>
<script>var ytInitialPlayerResponse = ${JSON.stringify({
  playabilityStatus: {
    status: "LOGIN_REQUIRED",
    reason: "Sign in to confirm you\u2019re not a bot",
  },
})};</script>
</body></html>`;

export const playlistId = "PLaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** An oEmbed answer for a video, in the shape YouTube sends. */
export const oembedVideo = JSON.stringify({
  title: "A Synthetic Video, Told by oEmbed",
  author_name: "Synthetic Channel",
  author_url: "https://www.youtube.com/@synthetic-channel",
  type: "video",
  height: 113,
  width: 200,
  version: "1.0",
  provider_name: "YouTube",
  provider_url: "https://www.youtube.com/",
  thumbnail_height: 360,
  thumbnail_width: 480,
  thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  html: "<iframe></iframe>",
});

export const oembedPlaylist = JSON.stringify({
  title: "A Synthetic Playlist",
  author_name: "Synthetic Channel",
  type: "video",
  version: "1.0",
  provider_name: "YouTube",
  thumbnail_url: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg",
});

export const ogImagePage = `<html lang="en"><head><title>A Page With a Preview</title>
<meta property="og:image" content="/images/preview.png?v=2">
<meta property="article:author" content="https://example.com/people/ada">
<meta name="author" content="  Ada  Example ">
<meta name="twitter:image" content="https://cdn.example.com/twitter.png">
<meta property="og:description" content="A synthetic page that has a preview image.">
</head><body><main><p>This page is written in English, and it has a preview image.</p></main>
</body></html>`;

export const twitterImagePage = `<html><head><title>Twitter Card Only</title>
<meta name="twitter:image" content="https://cdn.example.com/twitter.png">
<meta property="article:author" content="Grace Example">
</head><body><p>Body text of the page with a twitter card.</p></body></html>`;

export const dataImagePage = `<html><head><title>Inline Image</title>
<meta property="og:image" content="data:image/png;base64,AAAA">
<meta property="article:author" content="https://example.com/people/ada">
</head><body><p>Body text of the page with an inline image.</p></body></html>`;

/** A page with a title and a description and no readable text: a script-rendered app. */
export const emptyAppPage = `<html><head><title>Synthetic Board</title>
<meta property="og:description" content="A kanban board for small teams.">
<meta property="og:image" content="https://example.com/board.png">
</head><body><div id="app"></div><script>boot()</script></body></html>`;
