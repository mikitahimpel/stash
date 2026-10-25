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
