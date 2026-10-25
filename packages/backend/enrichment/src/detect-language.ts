import * as Option from "effect/Option";

// A heuristic language guess, good enough to tag a link and pick a summary language. Scripts with
// one dominant language (Cyrillic, Greek, CJK, …) are told apart by letters; Latin-script texts by
// counting common function words. Anything unclear stays `None`.

/** How much text is looked at. */
const sampleLength = 5_000;

const stopwords: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set(
    "the and of to is in that it for with as was on are this be by you not or have".split(" "),
  ),
  de: new Set(
    "der die und das ist nicht ein eine zu den mit sich von auf ich für dem des auch".split(" "),
  ),
  fr: new Set(
    "le la les et des est une un pas que pour dans qui sur avec ce du au sont".split(" "),
  ),
  es: new Set("el la los las y es que en por una un para con del se lo no como más".split(" ")),
  it: new Set("il la di che e è per un una non sono gli della con del le si anche".split(" ")),
  pt: new Set("o a os as e de que não do da em um uma para com é por mais".split(" ")),
  nl: new Set("de het en een van is dat niet op te zijn met voor die ook als".split(" ")),
  pl: new Set("i w nie na się że jest to z do jak co ale tak już od".split(" ")),
};

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

const byScript = (text: string): Option.Option<string> => {
  const letters = count(text, /\p{L}/gu);
  if (letters === 0) return Option.none();
  const share = (pattern: RegExp) => count(text, pattern) / letters;
  if (share(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) > 0.1) return Option.some("ja");
  if (share(/\p{Script=Hangul}/gu) > 0.3) return Option.some("ko");
  if (share(/\p{Script=Han}/gu) > 0.3) return Option.some("zh");
  if (share(/\p{Script=Cyrillic}/gu) > 0.5) {
    if (/[ўЎ]/u.test(text)) return Option.some("be");
    if (/[їЇєЄґҐ]/u.test(text) || (/[іІ]/u.test(text) && !/[ыЫэЭ]/u.test(text))) {
      return Option.some("uk");
    }
    return Option.some("ru");
  }
  if (share(/\p{Script=Greek}/gu) > 0.5) return Option.some("el");
  if (share(/\p{Script=Arabic}/gu) > 0.5) return Option.some("ar");
  if (share(/\p{Script=Hebrew}/gu) > 0.5) return Option.some("he");
  return Option.none();
};

const byStopwords = (text: string): Option.Option<string> => {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 5) return Option.none();
  let best: { language: string; hits: number } | undefined;
  for (const [language, set] of Object.entries(stopwords)) {
    const hits = words.reduce((sum, word) => (set.has(word) ? sum + 1 : sum), 0);
    if (best === undefined || hits > best.hits) best = { language, hits };
  }
  return best !== undefined && best.hits >= 3 && best.hits / words.length >= 0.05
    ? Option.some(best.language)
    : Option.none();
};

/** `en-US` → `en`. Anything that is not a plausible primary subtag is `None`. */
export const normalizeTag = (tag: string): Option.Option<string> => {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return /^[a-z]{2,3}$/.test(primary) ? Option.some(primary) : Option.none();
};

/**
 * Guesses the language of `text`. The text wins over the `declared` tag (pages often keep a
 * template's `lang="en"`), and the declared tag is used when the text gives no clear answer.
 */
export const detect = (text: string, declared?: string): Option.Option<string> => {
  const sample = text.slice(0, sampleLength);
  return byScript(sample).pipe(
    Option.orElse(() => byStopwords(sample)),
    Option.orElse(() => (declared === undefined ? Option.none() : normalizeTag(declared))),
  );
};
