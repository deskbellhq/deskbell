import { z } from "zod";
import type { EvalCase, Judge, TargetAnswer, Verdict } from "../types";
import { gradeFromFacts, reconcileFacts } from "./grade";

/**
 * Injected rather than constructed here: `packages/evals` must never import a
 * provider SDK (root rule 8, D4/D13). `@deskbell/core/models` supplies this.
 */
export interface LlmJudgeDeps {
  modelId: string;
  /** The model under evaluation. When it equals modelId, the judge self-grades. */
  targetModelId?: string;
  complete(opts: { system: string; prompt: string }): Promise<string>;
}

/**
 * A judge marking its own homework shares the blind spot that produced the
 * answer, so it rates its own failure modes as successes. The caveat is baked
 * into the judge's NAME rather than kept beside it, because the name is what
 * reaches the report, the baseline and anything quoted from them.
 */
export function judgeName(deps: LlmJudgeDeps): string {
  const selfGraded = deps.targetModelId !== undefined && deps.targetModelId === deps.modelId;
  return `llm:${deps.modelId}${selfGraded ? " (self-graded)" : ""}`;
}

const SYSTEM = `You grade answers produced by a documentation assistant.

You are given a question, the marking criteria (the facts a correct answer MUST
contain), the answer, and the context the answer was allowed to draw on.

Decide TWO separate things.

1. For EACH marking criterion, is that fact present in the answer? A fact counts
   as present if the answer states it in ANY wording. It does not count if the
   answer merely gestures at the topic, or names something adjacent to it.

2. Separately, is the answer grounded? True only if every claim in it is
   supported by the provided context.

These two do not affect each other. A fact stated correctly is PRESENT even when
the context does not support it — that is present: true with grounded: false,
and it is a real and useful combination. Never mark a fact absent because you
doubt where it came from.

Reply with JSON only, no prose and no code fences. List the facts first and the
reason last: the reason describes the judgements above, it does not justify a
conclusion reached first.
{"facts":[{"fact":"<criterion, quoted verbatim>","present":true|false}],"grounded":true|false,"reason":"one sentence"}
Return one entry per marking criterion, quoting each criterion exactly as given.`;

const VerdictSchema = z.object({
  facts: z.array(z.object({ fact: z.string(), present: z.boolean() })).default([]),
  grounded: z.boolean().nullable().default(null),
  reason: z.string(),
});

/** Models wrap JSON in fences often enough that not handling it is a bug. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`judge did not return JSON: ${text.slice(0, 200)}`);
  }
  return JSON.parse(body.slice(start, end + 1));
}

function contextOf(answer: TargetAnswer): string {
  const parts = (answer.retrieved ?? [])
    .map((c) => c.content)
    .filter((c): c is string => typeof c === "string" && c.length > 0);
  return parts.join("\n\n---\n\n");
}

/**
 * The opt-in judge. Needs a key, costs tokens, and never gates CI — it produces
 * the absolute numbers the deterministic matcher cannot. The one-line `reason`
 * is not decoration: marking criteria are never right on the first pass, and
 * reading why a case was graded C is how they get fixed.
 */
export function createLlmJudge(deps: LlmJudgeDeps): Judge {
  return {
    name: judgeName(deps),
    async grade(evalCase: EvalCase, answer: TargetAnswer): Promise<Verdict> {
      const facts = evalCase.expectedFacts ?? [];
      if (answer.refused) {
        return {
          grade: "C",
          reason: "refused an answerable question",
          matchedFacts: [],
          missingFacts: facts,
          grounded: null,
        };
      }

      const context = contextOf(answer);
      // A follow-up is judged in its thread: the question alone ("which one
      // then?") would be unreadable without the turns that led to it.
      const thread = (evalCase.history ?? [])
        .map((t) => `${t.role === "user" ? "Visitor" : "Assistant"}: ${t.content}`)
        .join("\n");
      const prompt = [
        thread ? `Conversation so far:\n${thread}` : "",
        `Question: ${evalCase.question}`,
        `Marking criteria (required facts):\n${facts.map((f) => `- ${f}`).join("\n")}`,
        evalCase.keyFact ? `Key fact: ${evalCase.keyFact}` : "",
        `Answer:\n${answer.answer}`,
        context ? `Context the answer could draw on:\n${context}` : "Context: (not available)",
      ]
        .filter(Boolean)
        .join("\n\n");

      const raw = await deps.complete({ system: SYSTEM, prompt });
      const parsed = VerdictSchema.parse(extractJson(raw));

      const claimed = parsed.facts.filter((f) => f.present).map((f) => f.fact);
      const { matched, missing, anomaly } = reconcileFacts(evalCase, claimed);

      return {
        // Derived, never read off the model: the judge answers one binary
        // question per criterion and the letter follows from the answers.
        grade: gradeFromFacts(facts, matched, evalCase.keyFact),
        reason: parsed.reason,
        matchedFacts: matched,
        missingFacts: missing,
        // With no context there is nothing to be grounded against; saying
        // "false" would report a hallucination we did not observe.
        grounded: context ? parsed.grounded : null,
        anomaly,
      };
    },
  };
}
