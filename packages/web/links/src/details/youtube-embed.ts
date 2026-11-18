// A YouTube link's embedded player. The address comes from the link's URL alone, with no request:
// the player itself loads only when the user presses play (`<MediaHero>`).

const hosts = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

const videoId = /^[\w-]{11}$/;

/** The id of the video a URL points to, for `watch?v=`, `youtu.be/`, `shorts/`, `live/`, `embed/`. */
export const id = (url: string): string | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  const host = parsed.hostname.replace(/^www\./, "");
  const [first, second] = parsed.pathname.split("/").filter((part) => part !== "");
  const found =
    host === "youtu.be"
      ? first
      : !hosts.has(host)
        ? undefined
        : first === "watch"
          ? (parsed.searchParams.get("v") ?? undefined)
          : first === "shorts" || first === "live" || first === "embed"
            ? second
            : undefined;
  return found !== undefined && videoId.test(found) ? found : undefined;
};

/**
 * The player for a YouTube URL, on the cookie-less domain and starting at once (it is only loaded
 * on a press of play). `undefined` for any other URL.
 */
export const player = (url: string): string | undefined => {
  const video = id(url);
  return video === undefined
    ? undefined
    : `https://www.youtube-nocookie.com/embed/${video}?autoplay=1`;
};
