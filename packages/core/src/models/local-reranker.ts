import { MAX_RERANK_CANDIDATES, type Reranker } from "../retrieval/reranker";

/**
 * The local cross-encoder reranker driver (spec: local-cross-encoder-reranker).
 *
 * Part of THE model-config module (root AGENTS rule 8; D4/D13) — it runs a
 * model, so it lives here and is injected into the engine as `rerank`.
 *
 *   DESKBELL_RERANK=local
 *   DESKBELL_RERANK_MODEL   a sequence-classification cross-encoder id on the
 *                           Hugging Face hub, ONNX weights;
 *                           default Xenova/ms-marco-MiniLM-L-6-v2
 *
 * A cross-encoder reads (question, passage) PAIRS and emits one relevance
 * logit per pair — purpose-built ranking, not a chat model asked to count.
 * It runs IN-PROCESS on CPU via ONNX: no sidecar, no service, docker-compose
 * untouched (D11 — the rule the interface's doc comment states). The engine
 * cannot abort a native forward pass, so this driver takes no timeout; the
 * batch is bounded by the shared candidate cap instead, and the engine's
 * try/catch still owns the fallback.
 *
 * The inference dependency is OPTIONAL and heavy (native onnxruntime
 * binaries), so it is a peer dependency the operator installs deliberately —
 * see the spec for why it must never become a hard dependency of the default
 * install. Model weights (~25 MB quantized) download from the Hugging Face
 * hub on first use and cache locally; air-gapped deployments pre-seed the
 * cache (documented in deploy/environment-variables.mdx).
 */

const DEFAULT_LOCAL_RERANK_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";

/**
 * Per-passage excerpt handed to the tokenizer. The model truncates at its own
 * 512-token ceiling anyway; slicing first keeps tokenization from chewing
 * through whole chunks it would then discard.
 */
const EXCERPT_CHARS = 1500;

/** What a loaded cross-encoder must do — the seam unit tests fake. */
export interface CrossEncoder {
  /** One relevance logit per (question, passage) pair, passage order preserved. */
  score(question: string, passages: string[]): Promise<number[]>;
}

/**
 * Loads the real model through the optional dependency. The specifier is a
 * variable on purpose: bundlers and the type checker must not try to resolve
 * a package that is legitimately absent — its absence is a supported state
 * with a defined error, not a build failure.
 */
async function loadCrossEncoder(modelId: string): Promise<CrossEncoder> {
  const optionalDependency = "@huggingface/transformers";
  let hf: {
    AutoTokenizer: { from_pretrained: (id: string) => Promise<unknown> };
    AutoModelForSequenceClassification: {
      from_pretrained: (id: string, opts: { dtype: string }) => Promise<unknown>;
    };
  };
  try {
    hf = await import(optionalDependency);
  } catch (cause) {
    throw new Error(
      `DESKBELL_RERANK=local needs the optional dependency ${optionalDependency} — ` +
        "install it next to the app that runs the engine (pnpm add " +
        `${optionalDependency}), or set DESKBELL_RERANK to off or llm.`,
      { cause },
    );
  }
  const tokenizer = (await hf.AutoTokenizer.from_pretrained(modelId)) as (
    questions: string[],
    opts: { text_pair: string[]; padding: boolean; truncation: boolean },
  ) => unknown;
  // Quantized weights: a fraction of the download and RAM for ranking-grade
  // output — this is an ordering, not a generation.
  const model = (await hf.AutoModelForSequenceClassification.from_pretrained(modelId, {
    dtype: "q8",
  })) as (inputs: unknown) => Promise<{ logits: { data: ArrayLike<number> } }>;

  return {
    async score(question, passages) {
      const inputs = tokenizer(new Array(passages.length).fill(question), {
        text_pair: passages,
        padding: true,
        truncation: true,
      });
      const { logits } = await model(inputs);
      // Shape [n, 1]: one logit per pair, flattened.
      return Array.from(logits.data);
    },
  };
}

/**
 * Loaded encoders, PROCESS-WIDE and keyed by model id: the web app constructs
 * engine deps per request, and re-loading tokenizer + weights per request
 * would cost seconds on every answer. One process loads a model once.
 * Injected test loaders bypass this cache so tests cannot bleed into each
 * other.
 */
const sharedEncoders = new Map<string, Promise<CrossEncoder>>();

/**
 * Builds the local driver. Loading — the dynamic import, the tokenizer, the
 * weights (a download on first ever use) — starts in the BACKGROUND at
 * construction so the first visitor usually finds it warm, but construction
 * itself never throws and never blocks: a missing package or a failed
 * download is a rerank error on the request path, where the engine degrades
 * to fusion order. A failed load is retried on the next request — the
 * operator may have installed the package or the network may be back.
 */
export function createLocalReranker(
  env: NodeJS.ProcessEnv,
  load: (modelId: string) => Promise<CrossEncoder> = loadCrossEncoder,
): Reranker {
  const modelId = env.DESKBELL_RERANK_MODEL?.trim() || DEFAULT_LOCAL_RERANK_MODEL;
  const shared = load === loadCrossEncoder;

  let instanceLoading: Promise<CrossEncoder> | undefined;
  const startLoading = (): Promise<CrossEncoder> => {
    let loading = shared ? sharedEncoders.get(modelId) : instanceLoading;
    if (!loading) {
      loading = load(modelId);
      // Swallow the background rejection so a failed warm-up cannot crash the
      // process; the request path awaits the same promise and handles it.
      loading.catch(() => {});
      if (shared) sharedEncoders.set(modelId, loading);
      else instanceLoading = loading;
    }
    return loading;
  };
  const resetLoading = () => {
    if (shared) sharedEncoders.delete(modelId);
    else instanceLoading = undefined;
  };
  startLoading();

  return async function rerank({ question, candidates }) {
    const pool = candidates.slice(0, MAX_RERANK_CANDIDATES);
    if (pool.length <= 1) return { order: pool.map((_, i) => i) };

    let encoder: CrossEncoder;
    try {
      encoder = await startLoading();
    } catch (error) {
      resetLoading();
      throw error;
    }

    const passages = pool.map((c) => `${c.title}\n${c.content.slice(0, EXCERPT_CHARS)}`);
    const scores = await encoder.score(question, passages);
    const order = scores
      .map((_, i) => i)
      .sort((a, b) => (scores[b] as number) - (scores[a] as number) || a - b);
    // Raw logits ride along on the driver's own scale (§5: a separate scale
    // from cosine; nothing thresholds it by default).
    return { order, scores: order.map((i) => scores[i] as number) };
  };
}
