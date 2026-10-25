import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import * as CraftExport from "../src/craft-export-parser.ts";

const fixture = `${import.meta.dirname}/fixtures/craft-export.synthetic`;
const NodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const parse = (markdown: string, path = "Doc.md") => CraftExport.parseDocument({ path, markdown });

describe("parseDocument", () => {
  it("extracts Markdown links, autolinks and bare URLs with their context", () => {
    const links = parse(
      [
        "# Synthetic Doc",
        "## Section",
        "- [Some Title](https://example.com/a) — a note",
        "Bare: https://example.com/b.",
        "<https://example.com/c>",
      ].join("\n"),
    );
    expect(links).toEqual([
      {
        url: "https://example.com/a",
        title: "Some Title",
        path: "Doc.md",
        document: "Synthetic Doc",
        headings: ["Section"],
        context: "Some Title — a note",
      },
      {
        url: "https://example.com/b",
        title: null,
        path: "Doc.md",
        document: "Synthetic Doc",
        headings: ["Section"],
        context: "Bare",
      },
      {
        url: "https://example.com/c",
        title: null,
        path: "Doc.md",
        document: "Synthetic Doc",
        headings: ["Section"],
        context: null,
      },
    ]);
  });

  it("tracks the heading path and resets deeper levels", () => {
    const links = parse(
      ["# Title", "## A", "### A1", "https://example.com/1", "## B", "https://example.com/2"].join(
        "\n",
      ),
    );
    expect(links.map((l) => l.headings)).toEqual([["A", "A1"], ["B"]]);
  });

  it("falls back to the file name when the document does not start with a title", () => {
    const links = parse(
      "Intro line.\n\n# Later Heading\nhttps://example.com/x",
      "Folder/My Doc.md",
    );
    expect(links[0]).toMatchObject({
      document: "My Doc",
      headings: ["Later Heading"],
      path: "Folder/My Doc.md",
    });
  });

  it("keeps balanced parentheses and drops trailing punctuation", () => {
    const links = parse(
      "See https://example.com/wiki/Thing_(x), and (https://example.com/y).\n[t](https://example.com/z_(q))",
    );
    expect(links.map((l) => l.url)).toEqual([
      "https://example.com/wiki/Thing_(x)",
      "https://example.com/y",
      "https://example.com/z_(q)",
    ]);
  });

  it("skips images, code and non-http URLs", () => {
    const links = parse(
      [
        "![alt](https://example.com/img.png)",
        "`https://example.com/inline`",
        "```js",
        "fetch('https://example.com/fenced')",
        "```",
        "~~~",
        "https://example.com/tilde-fenced",
        "~~~",
        "```",
        "```js is not a closing fence",
        "https://example.com/still-fenced",
        "```",
        "mailto:someone@example.com ftp://example.com/f [x](javascript:alert(1))",
        "https://example.com/after-code",
      ].join("\n"),
    );
    expect(links.map((l) => l.url)).toEqual(["https://example.com/after-code"]);
  });

  it("uses no title when the link text is the URL", () => {
    const links = parse("- [https://example.com/same](https://example.com/same) — a note");
    expect(links).toMatchObject([
      { url: "https://example.com/same", title: null, context: "a note" },
    ]);
    expect(links).toHaveLength(1);
  });

  it("does not extract a URL from the link text as a link of its own", () => {
    expect(parse("[https://example.com/a](https://example.com/b)")).toEqual([
      expect.objectContaining({ url: "https://example.com/b", title: null, context: null }),
    ]);
    const [link, ...others] = CraftExport.parseDocuments([
      { path: "a.md", markdown: "[https://example.com/same](https://example.com/same)" },
    ]);
    expect(others).toEqual([]);
    expect(link?.sources).toHaveLength(1);
  });

  it("keeps link text that mixes words and a URL as the title", () => {
    expect(parse("[mirror of https://example.com/a](https://example.com/b)")).toMatchObject([
      { url: "https://example.com/b", title: "mirror of https://example.com/a" },
    ]);
  });

  it("normalizes URLs and handles CRLF and a BOM", () => {
    const links = parse("﻿# T\r\nHTTPS://Example.COM/Path\r\n");
    expect(links).toMatchObject([{ url: "https://example.com/Path", document: "T" }]);
  });
});

describe("dedupe", () => {
  it("merges the same URL across documents, keeping every source", () => {
    const links = CraftExport.parseDocuments([
      { path: "b.md", markdown: "# B\n[Named](https://example.com/dup)" },
      { path: "a.md", markdown: "# A\nhttps://example.com/dup\nhttps://example.com/only-a" },
    ]);
    expect(links.map((l) => [l.url, l.title, l.sources.map((s) => s.document)])).toEqual([
      ["https://example.com/dup", "Named", ["A", "B"]],
      ["https://example.com/only-a", null, ["A"]],
    ]);
  });
});

describe("parseExport", () => {
  it.effect("walks the synthetic export folder", () =>
    Effect.gen(function* () {
      const links = yield* CraftExport.parseExport(fixture);
      expect(links.map((l) => l.url)).toEqual([
        // Projects/Garden Planner.md
        "https://example.com/articles/composting?ref=newsletter",
        "https://tools.example.com/calendar",
        // Projects/Untitled Notes.md
        "https://example.com/ideas/raised-beds",
        // Reading List.md
        "https://example.org/blog/soil-ph",
        "https://example.net/long-read",
        "https://example.com/archive/old-post",
        "https://example.com/wiki/Tomato_(plant)",
        "https://video.example.com/watch?v=abc123",
      ]);

      const composting = links[0]!;
      expect(composting.title).toBe("Composting for Beginners");
      expect(composting.sources).toEqual([
        {
          path: "Projects/Garden Planner.md",
          document: "Garden Planner",
          headings: ["Tools"],
          context: "Seed tracker",
        },
        {
          path: "Reading List.md",
          document: "Reading List",
          headings: ["Articles"],
          context: "Composting for Beginners — a gentle intro",
        },
      ]);

      expect(links[1]).toMatchObject({
        title: "Planting Calendar",
        sources: [
          { headings: ["Tools"], context: "Planting Calendar" },
          { headings: ["Notes"], context: "See also the calendar for frost dates." },
        ],
      });
      expect(links[2]?.sources[0]).toMatchObject({
        document: "Untitled Notes",
        headings: ["Ideas"],
      });
      expect(links[5]).toMatchObject({
        title: "Old Post",
        sources: [{ headings: ["Articles", "Archive"] }],
      });
      expect(links[7]).toMatchObject({
        title: "Pruning 101",
        sources: [{ headings: ["Videos"], context: "Watch Pruning 101 later" }],
      });
    }).pipe(Effect.provide(NodeLayer)),
  );

  it.effect("fails with CraftExportError when the folder cannot be read", () =>
    Effect.gen(function* () {
      const error = yield* CraftExport.parseExport(`${fixture}/missing`).pipe(Effect.flip);
      expect(error._tag).toBe("CraftExportError");
    }).pipe(Effect.provide(NodeLayer)),
  );

  it.effect("reads through the FileSystem service", () =>
    Effect.gen(function* () {
      const links = yield* CraftExport.parseExport("/export");
      expect(links.map((l) => [l.url, l.sources[0]?.path])).toEqual([
        ["https://example.com/in-memory", "Sub/Doc.md"],
      ]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          FileSystem.layerNoop({
            readDirectory: () =>
              Effect.succeed(["Sub", "Sub/Doc.md", "Sub/Doc.assets/a.png", "Folder.md"]),
            stat: (path) =>
              Effect.succeed({
                type: path === "/export/Folder.md" ? "Directory" : "File",
              } as FileSystem.File.Info),
            readFileString: (path) =>
              Effect.succeed(
                path === "/export/Sub/Doc.md" ? "# Doc\nhttps://example.com/in-memory" : "",
              ),
          }),
          NodePath.layerPosix,
        ),
      ),
    ),
  );
});
