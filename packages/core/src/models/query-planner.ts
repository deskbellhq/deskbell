import { generateObject } from "ai";
import { z } from "zod";

import type { Turn } from "../engine";
import { type QueryPlan, type QueryPlanInput, unplannedQuery } from "../retrieval/query-plan";

/**
 * The query planner (spec: grounded-generation).
 *
 * Part of THE model-config module (root AGENTS rule 8; D4/D13) — it reaches a
 * model, so it lives here and is injected into the engine as `planQuery`.
 *
 *   DESKBELL_QUERY_PLANNING  followups (default) | always | off
 *   DESKBELL_PLANNER_MODEL   provider/model, defaults to the chat model
 */

/**
 * Searches the planner writes in addition to the canonical question.
 *
 * The canonical question always takes the first slot, so this is the number of
 * ADDITIONAL angles asked for — not the total. Asking for the total invites the
 * model to spend one of them rewording the question, which is already searched.
 */
const VARIANTS = 2;

const PlanSchema = z.object({
  canonicalQuestion: z.string().min(1),
  variants: z.array(z.string().min(1)),
});

/**
 * The count is stated here in prose AND bounded in the schema on purpose:
 * providers validate types and required keys but do not enforce array length,
 * so a schema-only cap silently overruns and the overflow is paid for and
 * discarded.
 *
 * The pronoun rule carries a worked example rather than being stated as a rule.
 * A constraint phrased as an instruction is reliably ignored here; the same
 * constraint carrying one worked rewrite holds.
 */
const SYSTEM = `You prepare search queries for a documentation search engine. You never answer the question.

Given the conversation so far and the visitor's latest message, produce two things.

canonicalQuestion — the latest message rewritten so it stands alone with no conversation history. Resolve every pronoun and implicit reference against the conversation. Fix obvious typos. Add no detail the visitor did not give.

Worked example. Given this conversation:
  visitor: How do I add a documentation source?
  assistant: Open Sources in the dashboard and paste the URL.
  visitor: and how do I remove it?
canonicalQuestion is "How do I remove a documentation source?"
"it" became "a documentation source". It is NOT "How do I remove it?", and NOT "How do I remove the dashboard?" — the reference is to what the visitor asked about, not to the last thing mentioned.

variants — write exactly ${VARIANTS} further search queries. Each must approach the same information need from a DIFFERENT ANGLE, not reword the question:
  - the wording the product's own documentation would use
  - the plain-language wording someone unfamiliar would use
  - the prerequisite step the visitor may actually be missing
Do not paraphrase canonicalQuestion — it is searched already, so a paraphrase spends a search on a search we are running anyway.
Do not add a product, company or brand name to any query. In a corpus about one product it matches everything and weakens the search.`;

function transcript(history: Turn[]): string {
  return history.map((turn) => `${turn.role}: ${turn.content}`).join("\n");
}

export type QueryPlanning = "followups" | "always" | "off";

export function readPlanningMode(env: NodeJS.ProcessEnv): QueryPlanning {
  const raw = env.DESKBELL_QUERY_PLANNING?.trim().toLowerCase();
  if (raw === "always" || raw === "off" || raw === "followups") return raw;
  if (raw) {
    console.warn(`[planner] unknown DESKBELL_QUERY_PLANNING "${raw}" — using "followups"`);
  }
  return "followups";
}

/**
 * Builds the planner, or `undefined` when planning is off — in which case the
 * engine searches the message exactly as asked, which is what it did before
 * this existed.
 *
 * `languageModel` is passed in rather than imported so this module stays free
 * of the provider switch.
 */
export function createQueryPlanner(
  languageModel: (id: string) => Parameters<typeof generateObject>[0]["model"],
  env: NodeJS.ProcessEnv,
  chatModelId: string,
): ((input: QueryPlanInput) => Promise<QueryPlan>) | undefined {
  const mode = readPlanningMode(env);
  if (mode === "off") return undefined;

  // Its own setting: changing the model that writes answers must not silently
  // change how questions are resolved.
  const plannerModelId = env.DESKBELL_PLANNER_MODEL?.trim() || chatModelId;

  // Built on first use, not here. Constructing it eagerly would throw out of
  // createEngineModelDeps for an unsupported provider id, which would fail
  // EVERY answer — including first turns that never plan — over a setting that
  // is only ever meant to cost quality. Inside the call it is a planner error,
  // and the engine falls back to searching the question as asked.
  let model: ReturnType<typeof languageModel> | undefined;

  return async function planQuery(input: QueryPlanInput): Promise<QueryPlan> {
    const history = input.history ?? [];

    // On "followups", a first turn has no reference to resolve, so the call
    // would be latency in front of the answer for nothing. Expansion would
    // still help — that is what "always" buys, and why it is a separate mode
    // rather than an inference from the history being empty.
    if (mode === "followups" && history.length === 0) return unplannedQuery(input.message);

    model ??= languageModel(plannerModelId);
    const { object } = await generateObject({
      model,
      schema: PlanSchema,
      system: SYSTEM,
      prompt: history.length
        ? `Conversation so far:\n${transcript(history)}\n\nLatest message: ${input.message}`
        : `Latest message: ${input.message}`,
    });

    if (object.variants.length > VARIANTS) {
      // Loud rather than silent: an overrun means tokens were spent on searches
      // about to be thrown away, and the prompt is what needs fixing.
      console.warn(
        `[planner] asked for ${VARIANTS} variants, got ${object.variants.length} — trimming`,
      );
    }

    return {
      canonicalQuestion: object.canonicalQuestion,
      queries: [object.canonicalQuestion, ...object.variants.slice(0, VARIANTS)],
    };
  };
}
