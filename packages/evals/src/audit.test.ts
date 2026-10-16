import { describe, expect, it } from "vitest";
import {
  type AuditCorpus,
  type AuditDocument,
  auditLabels,
  factsPresent,
  renderLabelAudit,
} from "./audit";
import type { Dataset, EvalCaseResult, EvalReport } from "./types";

const doc = (id: string, url: string, chunks: string[]): AuditDocument => ({
  id,
  url,
  title: id,
  chunks,
});

function corpusOf(...docs: AuditDocument[]): AuditCorpus {
  return {
    byId: new Map(docs.map((d) => [d.id, d])),
    idByUrl: new Map(docs.map((d) => [d.url ?? "", d.id])),
  };
}

const result = (over: Partial<EvalCaseResult>): EvalCaseResult => ({
  id: "c",
  kind: "answerable",
  question: "q",
  refused: false,
  grade: "A",
  score: 1,
  reason: "",
  matchedFacts: [],
  missingFacts: [],
  factCoverage: 1,
  judgeAnomaly: false,
  correctRefusal: null,
  falseRefusal: false,
  clarified: false,
  correctClarification: null,
  complied: null,
  grounded: null,
  citationCount: 0,
  citedDocumentIds: [],
  retrievedDocumentIds: null,
  retrievedTopScore: null,
  retrievedMeanScore: null,
  unsupportedTermCount: null,
  retrieval: { recallAtK: 0, precisionAtK: 0, mrr: 0, ndcgAtK: 0 },
  citations: null,
  usage: { input: 0, output: 0, embedding: 0 },
  latencyMs: 0,
  ...over,
});

function reportOf(...cases: EvalCaseResult[]): EvalReport {
  return { cases, k: 8, target: "project:p" } as unknown as EvalReport;
}

const dataset: Dataset = {
  name: "t",
  cases: [
    {
      id: "c",
      question: "q",
      kind: "answerable",
      expectedFacts: ["SFTP", "port 22"],
      keyFact: "SFTP",
      relevantUrls: ["https://x.test/labelled"],
    },
  ],
};

describe("factsPresent", () => {
  it("matches across case and whitespace, anywhere in any chunk", () => {
    const d = doc("d", "https://x.test/d", ["first chunk", "Use   sftp on\nPort 22 here"]);
    expect(factsPresent(["SFTP", "port 22", "FTP over TLS"], d)).toEqual([
      { fact: "SFTP", present: true },
      { fact: "port 22", present: true },
      { fact: "FTP over TLS", present: false },
    ]);
  });
});

describe("auditLabels", () => {
  const labelled = doc("L", "https://x.test/labelled", ["sftp and port 22"]);

  it("skips cases at full recall or without retrieval scores", () => {
    const report = reportOf(
      result({ id: "c", retrieval: { recallAtK: 1, precisionAtK: 1, mrr: 1, ndcgAtK: 1 } }),
    );
    expect(auditLabels(report, dataset, corpusOf(labelled))).toEqual([]);
    expect(auditLabels(reportOf(result({ retrieval: null })), dataset, corpusOf(labelled))).toEqual(
      [],
    );
  });

  it("names a cited, unlabelled page that holds every criterion as a label candidate", () => {
    const other = doc("O", "https://x.test/other", ["SFTP works on port 22 as well"]);
    const report = reportOf(result({ citedDocumentIds: ["O"], retrievedDocumentIds: ["O", "Z"] }));
    const [audited] = auditLabels(report, dataset, corpusOf(labelled, other));
    expect(audited?.verdict).toBe("label-candidate");
    // Labels first, then cited, then the rest of what was retrieved.
    expect(audited?.rows.map((r) => [r.role, r.documentId, r.rank])).toEqual([
      ["label", "L", null],
      ["cited", "O", 1],
      ["retrieved", "Z", 2],
    ]);
  });

  it("calls a page holding only the key fact a partial candidate", () => {
    const other = doc("O", "https://x.test/other", ["SFTP is supported"]);
    const report = reportOf(result({ citedDocumentIds: ["O"], retrievedDocumentIds: ["O"] }));
    expect(auditLabels(report, dataset, corpusOf(labelled, other))[0]?.verdict).toBe(
      "partial-candidate",
    );
  });

  it("flags a correct answer with no supporting cited page as ungrounded, not as a label gap", () => {
    const other = doc("O", "https://x.test/other", ["nothing relevant"]);
    const report = reportOf(
      result({ grade: "A", citedDocumentIds: ["O"], retrievedDocumentIds: ["O"] }),
    );
    expect(auditLabels(report, dataset, corpusOf(labelled, other))[0]?.verdict).toBe(
      "ungrounded-correct",
    );
  });

  it("calls a wrong answer with no candidate a retrieval miss, and tolerates older reports", () => {
    // No retrievedDocumentIds at all: a report from before the column existed.
    const report = reportOf(result({ grade: "C", retrievedDocumentIds: undefined }));
    const [audited] = auditLabels(report, dataset, corpusOf(labelled));
    expect(audited?.verdict).toBe("retrieval-miss");
    expect(audited?.rows).toHaveLength(1);
  });
});

describe("renderLabelAudit", () => {
  it("summarises verdicts and lists one row per document", () => {
    const labelled = doc("L", "https://x.test/labelled", ["sftp and port 22"]);
    const other = doc("O", "https://x.test/other", ["SFTP works on port 22 as well"]);
    const report = reportOf(result({ citedDocumentIds: ["O"], retrievedDocumentIds: ["O"] }));
    const md = renderLabelAudit(auditLabels(report, dataset, corpusOf(labelled, other)), 8);
    expect(md).toContain("| label-candidate | 1 |");
    expect(md).toContain("## c — A · recall 0.00 · label-candidate");
    expect(md).toContain("| cited | 1 | O | https://x.test/other | 1 | 2/2 | — |");
  });
});
