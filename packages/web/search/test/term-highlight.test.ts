import { describe, expect, it } from "vitest";
import * as TermHighlight from "../src/results/term-highlight.ts";

const marked = (text: string, query: string) =>
  TermHighlight.split(text, query)
    .map((part) => (part.match ? `[${part.text}]` : part.text))
    .join("");

describe("terms", () => {
  it("keeps distinct words of two or more letters, longest first", () => {
    expect(TermHighlight.terms("  rust  a Rust async ")).toEqual(["async", "rust"]);
  });
});

describe("split", () => {
  it("marks every occurrence of every term, ignoring case", () => {
    expect(marked("Rust and rust-analyzer: RUST everywhere", "rust")).toBe(
      "[Rust] and [rust]-analyzer: [RUST] everywhere",
    );
    expect(marked("Effect Schema for TypeScript", "schema typescript")).toBe(
      "Effect [Schema] for [TypeScript]",
    );
  });

  it("matches Cyrillic case-insensitively", () => {
    expect(marked("Векторные базы данных и ВЕКТОРНЫЙ поиск", "векторн ПОИСК")).toBe(
      "[Векторн]ые базы данных и [ВЕКТОРН]ЫЙ [поиск]",
    );
  });

  it("prefers the longer of two overlapping terms", () => {
    expect(marked("rusty", "ru rust")).toBe("[rust]y");
  });

  it("joins back to the original text", () => {
    const text = "Мой стек: Rust, Go и Effect.";
    const parts = TermHighlight.split(text, "rust effect мой");
    expect(parts.map((part) => part.text).join("")).toBe(text);
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual([
      "Мой",
      "Rust",
      "Effect",
    ]);
  });

  it("treats regex characters in the query as text", () => {
    expect(marked("C++ (and c) in .NET", "c++ .net")).toBe("[C++] (and c) in [.NET]");
  });

  it("is one plain part with no terms, and nothing for empty text", () => {
    expect(TermHighlight.split("Some text", "  a ")).toEqual([{ text: "Some text", match: false }]);
    expect(TermHighlight.split("", "rust")).toEqual([]);
  });
});
