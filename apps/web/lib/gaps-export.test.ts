import { parseDataset } from "@deskbell/evals";
import { describe, expect, it } from "vitest";

import { attachTrend, type GapGroupWithTrend, type GapRow, groupGaps, resolvePeriod } from "./gaps";
import {
  CSV_COLUMNS,
  csvCell,
  evalCaseFor,
  evalCaseSkeleton,
  exportFilename,
  FACT_PLACEHOLDER,
  toCsv,
  toDataset,
} from "./gaps-export";

const NOW = new Date(Date.UTC(2026, 8, 10, 12, 0));
const period = resolvePeriod("30d", NOW);

function row(over: Partial<GapRow> & { messageId: string }): GapRow {
  return {
    conversationId: `conv-${over.messageId}`,
    question: "How do I export?",
    refused: true,
    feedback: null,
    feedbackReason: null,
    feedbackComment: null,
    refusalReason: null,
    sourcesNamed: null,
    retrievalTopScore: null,
    citations: null,
    createdAt: NOW,
    gapClusterId: null,
    cluster: null,
    ...over,
  };
}

const cluster = (label: string, status: "open" | "resolved" = "open") => ({
  label,
  status,
  resolvedAt: null,
  reopenedAt: null,
  embeddingModel: "m",
  analysis: null,
  analysisRequestedAt: null,
  analysisError: null,
  correctionDocumentId: null,
});

function groups(rows: GapRow[]): GapGroupWithTrend[] {
  return attachTrend(groupGaps(rows), [], period, NOW);
}

describe("csvCell", () => {
  it("quotes commas, quotes and newlines per RFC 4180", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
  });

  it("neutralises spreadsheet formulas in visitor-typed text", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    // The guard runs first, then quoting: a formula with quotes gets both.
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\tx")).toBe("'\tx");
  });
});

describe("toCsv", () => {
  it("writes the header and one row per group in the given order", () => {
    const csv = toCsv(
      groups([
        row({
          messageId: "a",
          question: "How do I export?",
          gapClusterId: "gap_abc123",
          cluster: cluster("How do I export?"),
        }),
        row({
          messageId: "b",
          question: "=evil",
          refused: false,
          feedback: "down",
          feedbackReason: "incorrect",
        }),
      ]),
    );
    const [header, first, second, trailing] = csv.split("\r\n");
    expect(header).toBe(CSV_COLUMNS.join(","));
    expect(first?.startsWith("gap_abc123,How do I export?,open,1,1,0,0,0,,0,new,")).toBe(true);
    expect(second?.startsWith(",'=evil,open,1,0,1,0,0,,0,new,")).toBe(true);
    expect(second).toContain("incorrect");
    expect(first?.endsWith(",,,")).toBe(true); // no analysis yet: three empty trailing columns
    expect(trailing).toBe("");
  });
});

describe("toCsv — evidence columns", () => {
  it("names a cited written answer as one, since it has no URL to stand for it", () => {
    const csv = toCsv(
      groups([
        row({
          messageId: "b",
          refused: false,
          feedback: "down",
          citations: [
            { documentId: "k", title: "Project keys", url: "https://d.test/keys", snippet: "" },
            { documentId: "h", title: "How do I cancel?", snippet: "", kind: "corrections" },
          ],
        }),
      ]),
    );
    const [, line] = csv.split("\r\n");
    expect(line).toContain("written answer: How do I cancel?; https://d.test/keys");
  });
});

describe("evalCaseFor / toDataset", () => {
  it("round-trips through the harness's dataset parser", () => {
    const g = groups([
      row({
        messageId: "a",
        question: "How do I export?",
        gapClusterId: "gap_abc123",
        cluster: cluster("How do I export?"),
      }),
      row({
        messageId: "b",
        question: "Exporting — how?",
        gapClusterId: "gap_abc123",
        cluster: cluster("How do I export?"),
        refused: false,
        feedback: "down",
      }),
    ]);
    const dataset = toDataset(g, { projectName: "Default project", period, exportedAt: NOW });
    const parsed = parseDataset(JSON.parse(JSON.stringify(dataset)));

    expect(parsed.name).toBe("real-traffic-default-project-30d");
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.cases[0]).toMatchObject({
      id: "real-how-do-i-export-abc123",
      kind: "answerable",
      expectedFacts: [FACT_PLACEHOLDER],
      relevantUrls: [],
      tags: ["real-traffic", "refused", "downvoted"],
      source: { kind: "real", messageId: "b", capturedAt: NOW.toISOString() },
    });
    expect(parsed.cases[0]?.notes).toContain('"Exporting — how?"');
  });

  it("keeps ids unique for two clusters with the same slug", () => {
    const g = groups([
      row({
        messageId: "a",
        question: "How do I export?",
        gapClusterId: "gap_000001",
        cluster: cluster("How do I export?"),
      }),
      row({
        messageId: "b",
        question: "How do I export?",
        gapClusterId: "gap_000002",
        cluster: cluster("How do I export?"),
      }),
    ]);
    const ids = toDataset(g, { projectName: "p", period, exportedAt: NOW }).cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(["real-how-do-i-export-000001", "real-how-do-i-export-000002"]);
  });

  it("takes suggested facts from the stored analysis, and the CSV carries the finding", () => {
    const analysed = {
      ...cluster("How do I export?"),
      analysis: {
        title: "Exporting data",
        finding: "Nothing covers exports.",
        recommendation: "Write an Exports page, with a comma.",
        suggestedFacts: ["Exports are CSV"],
        model: "m",
        analyzedAt: NOW.toISOString(),
        inputHash: "h",
      },
    };
    const g = groups([row({ messageId: "a", gapClusterId: "gap_1", cluster: analysed })]);
    expect(evalCaseFor(g[0] as GapGroupWithTrend).expectedFacts).toEqual(["Exports are CSV"]);
    const [, line] = toCsv(g).split("\r\n");
    expect(
      line?.endsWith(
        'Exporting data,Nothing covers exports.,"Write an Exports page, with a comma."',
      ),
    ).toBe(true);
  });

  it("uses suggested facts when given, and says so", () => {
    const [g] = groups([row({ messageId: "a" })]);
    const c = evalCaseFor(g as GapGroupWithTrend, { suggestedFacts: [" Exports are CSV ", ""] });
    expect(c.expectedFacts).toEqual(["Exports are CSV"]);
    expect(c.notes).toContain("suggested by analysis");
  });

  it("tags a resolved cluster and a weak answer", () => {
    const [g] = groups([
      row({
        messageId: "a",
        refused: false,
        retrievalTopScore: 0.1,
        gapClusterId: "gap_1",
        cluster: cluster("q", "resolved"),
      }),
    ]);
    expect(evalCaseFor(g as GapGroupWithTrend).tags).toEqual([
      "real-traffic",
      "weak-answer",
      "resolved",
    ]);
  });

  it("tags and exports an answer that named something the docs lack", () => {
    const [g] = groups([
      row({
        messageId: "a",
        refused: false,
        unsupportedTerms: ["Find and Replace", "Merge"],
        gapClusterId: "gap_1",
        cluster: cluster("q"),
      }),
      row({ messageId: "b", refused: false, unsupportedTerms: ["Merge"], gapClusterId: "gap_1" }),
    ]);
    expect(evalCaseFor(g as GapGroupWithTrend).tags).toEqual(["real-traffic", "unsupported-terms"]);
    const [header, line] = toCsv(attachTrend([g as GapGroupWithTrend], [], period, NOW)).split(
      "\r\n",
    );
    const cols = header?.split(",") ?? [];
    const cells = line?.split(",") ?? [];
    expect(cells[cols.indexOf("unsupported")]).toBe("2");
    expect(cells[cols.indexOf("unsupported_terms")]).toBe("Merge ×2; Find and Replace");
  });

  it("copy-as-eval-case emits exactly the exported case", () => {
    const [g] = groups([row({ messageId: "a" })]);
    expect(JSON.parse(evalCaseSkeleton(g as GapGroupWithTrend))).toEqual(
      evalCaseFor(g as GapGroupWithTrend),
    );
  });
});

describe("exportFilename", () => {
  it("names the view only when it is not the default open one", () => {
    expect(exportFilename("csv", "My Project", period, NOW, "open")).toBe(
      "deskbell-gaps-my-project-30d-2026-09-10.csv",
    );
    expect(exportFilename("dataset", "My Project", period, NOW, "resolved")).toBe(
      "deskbell-gaps-my-project-30d-resolved-2026-09-10.json",
    );
    expect(
      toDataset([], { projectName: "My Project", period, exportedAt: NOW, status: "all" }).name,
    ).toBe("real-traffic-my-project-30d-all");
  });

  it("names the project, period and date", () => {
    expect(exportFilename("csv", "Default project", period, NOW)).toBe(
      "deskbell-gaps-default-project-30d-2026-09-10.csv",
    );
    expect(exportFilename("dataset", "p", resolvePeriod("all", NOW), NOW)).toBe(
      "deskbell-gaps-p-all-2026-09-10.json",
    );
  });
});
