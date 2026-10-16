import { generateObject } from "ai";
import { z } from "zod";

import { MAX_RERANK_CANDIDATES, type Reranker } from "../retrieval/reranker";
import { createLocalReranker } from "./local-reranker";

/**
 * Reranker driver selection + the LLM driver (spec: hybrid-retrieval §4).
 *
 * Part of THE model-config module (root AGENTS rule 8; D4/D13) — drivers
 * reach models, so they live here and are injected into the engine as
 * `rerank`.
 *
 *   DESKBELL_RERANK             off (default) | llm | local
 *   DESKBELL_RERANK_MODEL       llm: provider/model, defaults to the chat model
 *                               local: a cross-encoder id on the HF hub,
 *                               defaults to Xenova/ms-marco-MiniLM-L-6-v2
 *   DESKBELL_RERANK_TIMEOUT_MS  llm only, default 10000; past it the engine
 *                               keeps fusion order (reasoning models need
 *                               seconds for a listwise ranking; a tighter
 *                               budget degrades every request and pays for
 *                               tokens it then discards). The local driver
 *                               takes no timeout — a native forward pass
 *                               cannot be aborted; its batch is bounded by
 *                               the candidate cap instead.
 *
 * The LLM driver is listwise on purpose: one call ranks the whole pool.
 * Scoring candidates one by one costs N serialized calls and yields poorly
 * calibrated absolute numbers, while a comparative ordering in a single
 * prompt is both cheaper and the judgment the task actually needs. It returns
 * an ORDER and no scores — point scores from a chat model are noise, and
 * nothing downstream may threshold what does not exist. The local driver (see
 * ./local-reranker) is a real cross-encoder and does return its logits.
 */

/**
 * The driver named by DESKBELL_RERANK, or undefined for off — the seam's
 * no-op default. An unknown value warns and stays off rather than guessing a
 * driver: silently picking one would change ranking over a typo.
 */
export function createReranker(
  languageModel: (id: string) => Parameters<typeof generateObject>[0]["model"],
  env: NodeJS.ProcessEnv,
  chatModelId: string,
): Reranker | undefined {
  const mode = env.DESKBELL_RERANK?.trim().toLowerCase();
  if (!mode || mode === "off") return undefined;
  if (mode === "llm") return createLlmReranker(languageModel, env, chatModelId);
  if (mode === "local") return createLocalReranker(env);
  console.warn(`[reranker] unknown DESKBELL_RERANK "${mode}" — reranking stays off`);
  return undefined;
}

/**
 * Per-passage excerpt length. The lede carries the passage's identity; paying
 * for whole chunks would multiply the prompt several-fold for marginal
 * ranking signal. A latency-and-cost budget, same framing as leg depth.
 */
const EXCERPT_CHARS = 1500;

const RankSchema = z.object({
  ranking: z.array(z.number().int().min(1)),
});

/**
 * The count is stated in the prompt in prose AND bounded in the schema on
 * purpose: providers validate types and required keys but do not enforce
 * array length, so a schema-only cap silently overruns and the overflow is
 * paid for and discarded (same lesson as the query planner).
 */
function system(count: number): string {
  return `You rank documentation passages by how well they answer a question. You never answer the question.

Return "ranking": ALL ${count} passage numbers, ordered from most to least relevant to the question. Rank every passage — deciding how many are worth using is not your job; producing the order is.
Rules:
- exactly ${count} numbers, each between 1 and ${count}, each exactly once
- a passage is relevant if it contains the facts the answer needs — not because it shares vocabulary with the question
- an exact match on an identifier, error code, config key or product term the question names outranks fluent text that merely discusses the topic`;
}

export function createLlmReranker(
  languageModel: (id: string) => Parameters<typeof generateObject>[0]["model"],
  env: NodeJS.ProcessEnv,
  chatModelId: string,
): Reranker {
  // Its own setting: changing the model that writes answers must not silently
  // change how candidates are ranked.
  const rerankModelId = env.DESKBELL_RERANK_MODEL?.trim() || chatModelId;

  const rawTimeout = env.DESKBELL_RERANK_TIMEOUT_MS?.trim();
  let timeoutMs = 10_000;
  if (rawTimeout) {
    const parsed = Number(rawTimeout);
    if (Number.isInteger(parsed) && parsed > 0) {
      timeoutMs = parsed;
    } else {
      console.warn(`[reranker] ignoring DESKBELL_RERANK_TIMEOUT_MS="${rawTimeout}" — using 10000`);
    }
  }

  // Built on first use, not here: constructing it eagerly would throw out of
  // createEngineModelDeps for an unsupported provider id and fail EVERY
  // answer over a setting only ever meant to cost quality. Inside the call it
  // is a rerank error, and the engine keeps fusion order.
  let model: ReturnType<typeof languageModel> | undefined;

  return async function rerank({ question, candidates, onUsage }) {
    const pool = candidates.slice(0, MAX_RERANK_CANDIDATES);
    if (pool.length <= 1) return { order: pool.map((_, i) => i) };

    model ??= languageModel(rerankModelId);
    const passages = pool
      .map((c, i) => `[${i + 1}] ${c.title}\n${c.content.slice(0, EXCERPT_CHARS)}`)
      .join("\n\n");
    const { object, usage } = await generateObject({
      model,
      schema: RankSchema,
      system: system(pool.length),
      prompt: `Question: ${question}\n\nPassages:\n${passages}`,
      // The driver owns the timeout; the engine still try/catches around the
      // whole call, so both layers fail safe.
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    onUsage?.({ input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 });

    if (object.ranking.length > pool.length) {
      // Loud rather than silent: an overrun means tokens were spent on a
      // ranking about to be discarded, and the prompt is what needs fixing.
      console.warn(
        `[reranker] asked for at most ${pool.length} entries, got ${object.ranking.length} — trimming`,
      );
    }
    // 1-based in the prompt (models miscount from 0), 0-based for the engine.
    // applyRanking repairs whatever else came back wrong.
    return { order: object.ranking.slice(0, pool.length).map((n) => n - 1) };
  };
}
