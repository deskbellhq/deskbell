import { describe, expect, it } from "vitest";
import { chunkText } from "./chunker";

const para = (word: string, times: number) => Array.from({ length: times }, () => word).join(" ");

describe("chunkText", () => {
  it("returns nothing for content that is only whitespace", () => {
    expect(chunkText("   \n\n  \n")).toEqual([]);
  });

  it("keeps a short document as a single chunk", () => {
    const chunks = chunkText("# Title\n\nOne short paragraph.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("One short paragraph.");
  });

  it("respects the hard cap on content when nothing is prepended", () => {
    const content = `# T\n\n${para("alpha", 400)}`;
    for (const chunk of chunkText(content, { targetChars: 300, maxChars: 400, overlapChars: 0 })) {
      expect(chunk.length).toBeLessThanOrEqual(400 + 8);
    }
  });

  it("lets overlap and the heading trail push a chunk past maxChars", () => {
    // Documenting real behaviour, not endorsing it: maxChars caps the CONTENT,
    // and the overlap tail plus heading breadcrumb are prepended afterwards, so
    // a chunk can run roughly overlapChars longer than the "hard cap" suggests.
    // Anything sizing a context window off maxChars alone will under-count.
    const content = `# T\n\n${para("alpha", 400)}`;
    const withOverlap = chunkText(content, { targetChars: 300, maxChars: 400, overlapChars: 350 });
    expect(Math.max(...withOverlap.map((c) => c.length))).toBeGreaterThan(400);
  });

  it("splits an oversized block at a sentence boundary when one is available", () => {
    const sentence = `${para("word", 30)}. `;
    const chunks = chunkText(sentence.repeat(8), {
      targetChars: 200,
      maxChars: 300,
      overlapChars: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // The first chunk is the one that proves the cut point was chosen, not forced.
    expect(chunks[0]?.trimEnd().endsWith(".")).toBe(true);
  });

  it("emits a heading-only block as its own chunk", () => {
    // Also documenting rather than endorsing: a document whose title is
    // followed by a blank line yields a chunk containing just the title. It can
    // never usefully answer anything and still costs an embedding. Retrieval
    // metrics in the harness are how a fix would be shown to help.
    const chunks = chunkText(`# Title\n\n${para("alpha", 400)}`, {
      targetChars: 300,
      maxChars: 400,
    });
    expect(chunks[0]).toBe("# Title");
  });

  it("repeats a tail of the previous chunk so a fact split across the seam survives", () => {
    // Without overlap, a sentence that straddles two chunks is retrievable from
    // neither — the classic silent recall bug in a RAG pipeline.
    const chunks = chunkText(
      `# T\n\n${para("alpha", 60)}\n\n${para("beta", 60)}\n\n${para("gamma", 60)}`,
      { targetChars: 300, maxChars: 400, overlapChars: 60 },
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]).toContain("…");
  });

  it("carries the heading trail into continuation chunks so they stand alone", () => {
    // A chunk that says "Set it to true" without saying what "it" is retrieves
    // badly and reads worse.
    const chunks = chunkText(
      `# Guide\n\n## Origins\n\n${para("alpha", 80)}\n\n${para("beta", 80)}`,
      { targetChars: 300, maxChars: 400, overlapChars: 40 },
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]).toContain("Guide > Origins");
  });

  it("is deterministic — the same input chunks the same way every time", () => {
    const content = `# T\n\n${para("alpha", 200)}\n\n${para("beta", 200)}`;
    expect(chunkText(content, { targetChars: 400, maxChars: 600 })).toEqual(
      chunkText(content, { targetChars: 400, maxChars: 600 }),
    );
  });
});
