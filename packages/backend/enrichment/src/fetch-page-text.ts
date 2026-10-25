import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as ContentHttp from "./content-http.ts";
import * as ContentText from "./content-text.ts";
import * as DetectLanguage from "./detect-language.ts";
import * as HtmlText from "./html-text.ts";

const isHtml = (contentType: string) =>
  contentType === "" || contentType.includes("text/html") || contentType.includes("xhtml");

/**
 * Fetches a web page and extracts its title, description and readable text. HTML is parsed,
 * `text/plain` is taken as is, and other content types (PDF, images, …) fail with
 * `UnsupportedContentType`.
 */
export const fetchPageText = (
  url: string,
): Effect.Effect<ContentText.ContentText, ContentHttp.ContentFetchError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const policy = yield* ContentHttp.FetchPolicy;
    const response = yield* ContentHttp.getText(url, {
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
    });
    if (isHtml(response.contentType)) {
      const page = HtmlText.parse(response.body);
      const text = ContentText.truncate(page.text, policy.maxTextLength);
      return {
        title: page.title,
        description: page.description,
        language: DetectLanguage.detect(text, Option.getOrUndefined(page.lang)),
        text,
        source: "page" as const,
      };
    }
    if (response.contentType.includes("text/plain")) {
      const text = ContentText.truncate(response.body.trim(), policy.maxTextLength);
      return {
        title: Option.none(),
        description: Option.none(),
        language: DetectLanguage.detect(text),
        text,
        source: "page" as const,
      };
    }
    return yield* new ContentHttp.ContentFetchError({ url, reason: "UnsupportedContentType" });
  });
