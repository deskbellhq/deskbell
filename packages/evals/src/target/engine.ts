import type { AnswerEngine, TokenUsage } from "@deskbell/core";
import type { EvalCase, RetrievedChunk, Target, TargetAnswer } from "../types";

export interface EngineTargetOptions {
  /**
   * Hears the names a checked answer could not support (spec:
   * answer-verification). Reports keep only the count; a CLI prints these to
   * stderr so the run's author can read what was flagged.
   */
  onUnsupportedTerms?: (caseId: string, terms: string[]) => void;
  engine: AnswerEngine;
  orgId: string;
  projectId: string;
  name?: string;
  /**
   * Stop each case after retrieval — no generation, no tokens, no answer. The
   * harness pairs this with a run that grades nothing (spec:
   * eval-measurement-fixes).
   */
  retrievalOnly?: boolean;
  /** Injected so a run can be timed without reaching for a wall clock in tests. */
  now?: () => number;
}

/**
 * Drives the engine in process. This is the target that can see everything —
 * retrieved chunks with their text, exact token counts — so it is the one that
 * supports every metric.
 */
export function createEngineTarget(opts: EngineTargetOptions): Target {
  const now = opts.now ?? (() => performance.now());

  return {
    name: opts.name ?? "engine",
    async ask(evalCase: EvalCase): Promise<TargetAnswer> {
      const usage: TokenUsage = { input: 0, output: 0, embedding: 0 };
      let retrieved: RetrievedChunk[] = [];
      let answer = "";
      let refused = false;
      let refusalReason: string | undefined;
      let clarified = false;
      let options: string[] = [];
      const citedDocumentIds: string[] = [];
      // Null until the engine reports a check (spec: answer-verification).
      let unsupportedTerms: string[] | null = null;

      const started = now();
      for await (const event of opts.engine.ask({
        orgId: opts.orgId,
        projectId: opts.projectId,
        // Derived from the case id, not generated: a run must not differ from
        // the last one because an id was random.
        conversationId: `eval_${evalCase.id}`,
        message: evalCase.question,
        locale: evalCase.locale,
        // Scripted prior turns, as the product would load them (spec:
        // answer-verification): the follow-up is asked in its thread.
        ...(evalCase.history ? { history: evalCase.history } : {}),
        retrievalOnly: opts.retrievalOnly,
        onUsage: (u) => {
          usage.input += u.input;
          usage.output += u.output;
          usage.embedding += u.embedding;
        },
        onRetrieval: (chunks) => {
          retrieved = chunks.map((c) => ({
            chunkId: c.chunkId,
            documentId: c.documentId,
            score: c.score,
            content: c.content,
          }));
        },
        onVerification: (report) => {
          unsupportedTerms = report.unsupported;
          if (report.unsupported.length > 0) {
            opts.onUnsupportedTerms?.(evalCase.id, report.unsupported);
          }
        },
      })) {
        if (event.type === "token") answer += event.value;
        else if (event.type === "citations") {
          for (const c of event.citations) {
            if (!citedDocumentIds.includes(c.documentId)) citedDocumentIds.push(c.documentId);
          }
        } else if (event.type === "refusal") {
          refused = true;
          refusalReason = event.reason;
        } else if (event.type === "clarify") {
          clarified = true;
          options = event.options;
        }
      }

      return {
        answer,
        refused,
        refusalReason,
        ...(clarified ? { clarified, options } : {}),
        citedDocumentIds,
        retrieved,
        unsupportedTerms,
        usage,
        latencyMs: now() - started,
      };
    },
  };
}
