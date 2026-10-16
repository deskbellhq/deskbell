import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Dataset, EvalCase } from "./types";

const EvalCaseSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    locale: z.string().optional(),
    kind: z.enum(["answerable", "unanswerable", "injection", "ambiguous"]),
    expectedFacts: z.array(z.string().min(1)).optional(),
    /** Ambiguous cases: page titles the clarifying question must offer (spec: clarifying-questions). */
    expectedOptions: z.array(z.string().min(1)).optional(),
    mustNotContain: z.array(z.string().min(1)).optional(),
    keyFact: z.string().min(1).optional(),
    relevantDocumentIds: z.array(z.string().min(1)).optional(),
    /** Resolved to relevantDocumentIds against the target corpus (spec: eval-url-labels). */
    relevantUrls: z.array(z.string().min(1)).optional(),
    /** Failure-mode labels, counted across cases below full marks. */
    tags: z.array(z.string().min(1)).optional(),
    notes: z.string().optional(),
    /** Prior turns, oldest first, for a follow-up case (spec: answer-verification). */
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) }))
      .max(6)
      .optional(),
    source: z
      .object({
        kind: z.enum(["real", "authored"]),
        messageId: z.string().optional(),
        capturedAt: z.string().optional(),
      })
      .optional(),
  })
  .refine((c) => c.kind !== "answerable" || (c.expectedFacts?.length ?? 0) > 0, {
    message:
      "an answerable case needs expectedFacts — without marking criteria there is nothing to grade against",
    path: ["expectedFacts"],
  })
  .refine((c) => c.kind !== "unanswerable" || !c.expectedFacts?.length, {
    message: "an unanswerable case must not carry expectedFacts — it is scored on refusing",
    path: ["expectedFacts"],
  })
  .refine((c) => c.kind !== "injection" || (c.mustNotContain?.length ?? 0) > 0, {
    message:
      "an injection case needs mustNotContain — the marker the corpus tries to make the model emit is the whole test",
    path: ["mustNotContain"],
  })
  .refine((c) => !c.keyFact || (c.expectedFacts ?? []).includes(c.keyFact), {
    message: "keyFact must also appear in expectedFacts",
    path: ["keyFact"],
  })
  .refine((c) => c.kind !== "ambiguous" || (c.expectedOptions?.length ?? 0) > 0, {
    message:
      "an ambiguous case needs expectedOptions — the pages a clarifying question must offer are the whole test",
    path: ["expectedOptions"],
  })
  .refine((c) => c.kind !== "ambiguous" || !c.expectedFacts?.length, {
    message:
      "an ambiguous case must not carry expectedFacts — it is scored on asking, not answering",
    path: ["expectedFacts"],
  })
  .refine((c) => c.kind === "ambiguous" || !c.expectedOptions?.length, {
    message: "expectedOptions belongs on an ambiguous case only",
    path: ["expectedOptions"],
  });

export const DatasetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  cases: z.array(EvalCaseSchema).min(1),
});

/** Duplicate ids would silently collapse two cases into one in any per-case diff. */
function assertUniqueIds(cases: EvalCase[]): void {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) dupes.add(c.id);
    seen.add(c.id);
  }
  if (dupes.size > 0) {
    throw new Error(`duplicate case ids in dataset: ${[...dupes].sort().join(", ")}`);
  }
}

export function parseDataset(raw: unknown): Dataset {
  const parsed = DatasetSchema.parse(raw);
  assertUniqueIds(parsed.cases);
  return parsed;
}

export async function loadDataset(path: string): Promise<Dataset> {
  const text = await readFile(path, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new Error(`${path} is not valid JSON`, { cause });
  }
  return parseDataset(raw);
}

export function splitByKind(dataset: Dataset): {
  answerable: EvalCase[];
  unanswerable: EvalCase[];
  injection: EvalCase[];
  ambiguous: EvalCase[];
} {
  return {
    answerable: dataset.cases.filter((c) => c.kind === "answerable"),
    unanswerable: dataset.cases.filter((c) => c.kind === "unanswerable"),
    injection: dataset.cases.filter((c) => c.kind === "injection"),
    ambiguous: dataset.cases.filter((c) => c.kind === "ambiguous"),
  };
}

/**
 * The shape a set should have: enough unanswerable cases to make Uncertainty
 * mean something, without crowding out the factuality half. Advisory — a small
 * fixture will not satisfy it and should not fail because of that.
 */
export function describeBalance(dataset: Dataset): string {
  const { answerable, unanswerable, injection, ambiguous } = splitByKind(dataset);
  const total = dataset.cases.length;
  const share = total === 0 ? 0 : Math.round((unanswerable.length / total) * 100);
  const parts = [
    `${total} cases`,
    `${answerable.length} answerable`,
    `${unanswerable.length} unanswerable (${share}%)`,
  ];
  if (injection.length > 0) parts.push(`${injection.length} injection`);
  if (ambiguous.length > 0) parts.push(`${ambiguous.length} ambiguous`);
  return parts.join(" · ");
}
