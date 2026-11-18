import { describe, expect, it } from "vitest";
import * as YoutubeEmbed from "../src/details/youtube-embed.ts";

// Synthetic ids: eleven characters, like real ones.
describe("YoutubeEmbed", () => {
  it.each([
    ["https://www.youtube.com/watch?v=synthetic01", "synthetic01"],
    ["https://youtube.com/watch?v=synthetic01&t=42s", "synthetic01"],
    ["https://m.youtube.com/watch?list=abc&v=synth-_ic02", "synth-_ic02"],
    ["https://youtu.be/synthetic01?si=share", "synthetic01"],
    ["https://www.youtube.com/shorts/synthetic01", "synthetic01"],
    ["https://www.youtube.com/live/synthetic01", "synthetic01"],
    ["https://www.youtube.com/embed/synthetic01", "synthetic01"],
    ["https://music.youtube.com/watch?v=synthetic01", "synthetic01"],
  ])("finds the video of %s", (url, id) => {
    expect(YoutubeEmbed.id(url)).toBe(id);
  });

  it.each([
    "https://example.com/watch?v=synthetic01",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/@example",
    "https://www.youtube.com/playlist?list=synthetic01",
    "https://youtu.be/",
    "https://notyoutube.com/watch?v=synthetic01",
    "https://www.youtube.com/watch?v=synthetic01%22%3E",
    "javascript:alert(1)",
    "not a url",
  ])("finds none in %s", (url) => {
    expect(YoutubeEmbed.id(url)).toBeUndefined();
    expect(YoutubeEmbed.player(url)).toBeUndefined();
  });

  it("plays on the cookie-less domain", () => {
    expect(YoutubeEmbed.player("https://youtu.be/synthetic01")).toBe(
      "https://www.youtube-nocookie.com/embed/synthetic01?autoplay=1",
    );
  });
});
