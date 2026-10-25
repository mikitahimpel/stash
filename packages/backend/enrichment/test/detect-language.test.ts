import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as DetectLanguage from "../src/detect-language.ts";

describe("DetectLanguage.detect", () => {
  it.each([
    ["en", "This is a short text that is written in English, and it is easy to read for the test."],
    [
      "de",
      "Das ist ein kurzer Text, der auf Deutsch geschrieben ist und nicht schwer zu lesen ist.",
    ],
    ["fr", "Ceci est un petit texte qui est écrit en français pour le test, et il est simple."],
    ["es", "Este es un texto corto que está escrito en español para la prueba y no es difícil."],
    ["ru", "Это короткий текст, который написан на русском языке для проверки."],
    ["uk", "Це короткий текст, який написаний українською мовою для перевірки її."],
    ["ja", "これはテスト用の短い日本語の文章です。"],
    ["zh", "这是一个用于测试的简短中文文本。"],
    ["ko", "이것은 테스트를 위한 짧은 한국어 문장입니다."],
    ["el", "Αυτό είναι ένα σύντομο ελληνικό κείμενο."],
  ])("recognizes %s", (language, text) => {
    expect(DetectLanguage.detect(text)).toEqual(Option.some(language));
  });

  it("prefers the text over a wrong declared tag", () => {
    expect(
      DetectLanguage.detect(
        "Das ist nicht ein Text auf Englisch, und der Browser ist es auch nicht.",
        "en",
      ),
    ).toEqual(Option.some("de"));
  });

  it("uses the declared tag when the text is unclear", () => {
    expect(DetectLanguage.detect("Qwerty 2024", "pt-BR")).toEqual(Option.some("pt"));
    expect(DetectLanguage.detect("Qwerty 2024")).toEqual(Option.none());
    expect(DetectLanguage.detect("", "not a tag")).toEqual(Option.none());
  });
});
