import type { Database } from "@deskbell/db";
import { describe, expect, it } from "vitest";
import type { Dataset } from "../types";
import { normalizeDocUrl, resolveUrlLabels } from "./project";

/**
 * The query is `select(...).from(documents).innerJoin(sources, ...).where(...)`,
 * and only its rows matter here. Faking the chain keeps these tests offline —
 * this module is the one place in the package that can touch a database, and a
 * test that needed one would not run in CI.
 */
function fakeDb(rows: Array<{ id: string; url: string | null }>): Database {
  return {
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: async () => rows }) }),
    }),
  } as unknown as Database;
}

const dataset = (over: Partial<Dataset["cases"][number]>): Dataset => ({
  name: "d",
  cases: [
    {
      id: "c1",
      question: "q",
      kind: "answerable",
      expectedFacts: ["f"],
      ...over,
    },
  ],
});

describe("normalizeDocUrl", () => {
  it("ignores a trailing slash, a fragment and host casing", () => {
    const canonical = "https://example.com/docs/a";
    expect(normalizeDocUrl("https://example.com/docs/a/")).toBe(normalizeDocUrl(canonical));
    expect(normalizeDocUrl("https://example.com/docs/a#section")).toBe(normalizeDocUrl(canonical));
    expect(normalizeDocUrl("https://EXAMPLE.com/docs/a")).toBe(normalizeDocUrl(canonical));
  });

  it("keeps a bare root path, which is not a trailing slash to strip", () => {
    expect(normalizeDocUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("passes a non-URL through, because the fixture labels by slug", () => {
    expect(normalizeDocUrl("installing")).toBe("installing");
  });
});

describe("resolveUrlLabels", () => {
  const rows = [
    { id: "doc_1", url: "https://example.com/docs/a" },
    { id: "doc_2", url: "https://example.com/docs/b" },
    { id: "doc_3", url: null },
  ];

  it("fills relevantDocumentIds from relevantUrls", async () => {
    const out = await resolveUrlLabels(
      fakeDb(rows),
      "proj",
      dataset({ relevantUrls: ["https://example.com/docs/b/"] }),
    );
    expect(out.cases[0]?.relevantDocumentIds).toEqual(["doc_2"]);
  });

  it("merges with ids already present rather than replacing them", async () => {
    const out = await resolveUrlLabels(
      fakeDb(rows),
      "proj",
      dataset({
        relevantDocumentIds: ["doc_9"],
        relevantUrls: ["https://example.com/docs/a"],
      }),
    );
    expect(new Set(out.cases[0]?.relevantDocumentIds)).toEqual(new Set(["doc_9", "doc_1"]));
  });

  it("throws naming every miss instead of leaving a label empty", async () => {
    // The whole point of the change. An unresolved label that silently scored
    // zero recall would read as a retrieval regression that never happened.
    await expect(
      resolveUrlLabels(
        fakeDb(rows),
        "proj",
        dataset({ relevantUrls: ["https://example.com/docs/gone"] }),
      ),
    ).rejects.toThrow(/docs\/gone/);
  });

  it("does not query at all when no case carries a URL label", async () => {
    const exploding = {
      select: () => {
        throw new Error("should not query");
      },
    } as unknown as Database;
    const input = dataset({ relevantDocumentIds: ["doc_1"] });
    await expect(resolveUrlLabels(exploding, "proj", input)).resolves.toBe(input);
  });
});
