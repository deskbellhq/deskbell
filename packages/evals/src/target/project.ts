import {
  buildSystemPrompt,
  clarifyFromEnv,
  createEngine,
  createVectorStore,
  lookupTerms,
  ownDataFromEnv,
  RETRIEVAL_DEFAULTS,
  type RetrievalOptions,
  verifyFromEnv,
} from "@deskbell/core";
import { createEngineModelDeps } from "@deskbell/core/models";
import { createDb, type Database, documents, projects, sources } from "@deskbell/db";
import { eq } from "drizzle-orm";
import { promptFingerprint } from "../prompt";
import type { Dataset, RetrievalProvenance, Target } from "../types";
import { createEngineTarget } from "./engine";

/**
 * `documents.url` holds the crawler's *final* URL after redirects, which will
 * not always equal what someone pasted out of a browser. Normalising both sides
 * keeps a label from missing over a trailing slash or a fragment.
 */
export function normalizeDocUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.host = u.host.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    // Not a URL at all (the fixture labels by slug) — compare it literally.
    return raw.trim().toLowerCase();
  }
}

/**
 * Resolves `relevantUrls` to `relevantDocumentIds` against one project's corpus
 * (spec: eval-url-labels).
 *
 * An unresolvable URL throws and names every miss. Filling in an empty label
 * instead would score zero recall for that case and read as a retrieval
 * regression that never happened — the exact failure this exists to remove.
 */
export async function resolveUrlLabels(
  db: Database,
  projectId: string,
  dataset: Dataset,
): Promise<Dataset> {
  if (!dataset.cases.some((c) => c.relevantUrls?.length)) return dataset;

  const rows = await db
    .select({ id: documents.id, url: documents.url })
    .from(documents)
    .innerJoin(sources, eq(sources.id, documents.sourceId))
    .where(eq(sources.projectId, projectId));

  const byUrl = new Map<string, string>();
  for (const row of rows) {
    if (row.url) byUrl.set(normalizeDocUrl(row.url), row.id);
  }

  const misses: string[] = [];
  const cases = dataset.cases.map((c) => {
    if (!c.relevantUrls?.length) return c;
    const ids = new Set(c.relevantDocumentIds ?? []);
    for (const url of c.relevantUrls) {
      const id = byUrl.get(normalizeDocUrl(url));
      if (id) ids.add(id);
      else misses.push(`${c.id}: ${url}`);
    }
    return { ...c, relevantDocumentIds: [...ids] };
  });

  if (misses.length > 0) {
    throw new Error(
      `${misses.length} relevantUrls do not resolve to a document in project ${projectId}. ` +
        "Either the corpus is incomplete or the label is wrong, and both invalidate this " +
        `run's retrieval numbers.\n  ${misses.join("\n  ")}`,
    );
  }

  return { ...dataset, cases };
}

export interface ProjectTargetOptions {
  projectId: string;
  connectionString?: string;
  /** Hears the names a checked answer could not support (spec: answer-verification). */
  onUnsupportedTerms?: (caseId: string, terms: string[]) => void;
  /**
   * Overrides the shipped retrieval settings, so tuning can be measured. The
   * full engine surface (spec: hybrid-retrieval) plus the reranker, which is
   * env-configured in the product and threaded through here so a sweep never
   * has to mutate the process environment.
   */
  retrieval?: RetrievalOptions & { rerank?: "off" | "llm" | "local"; rerankModel?: string };
  /**
   * Sampling temperature, when the configured model accepts one.
   *
   * Deliberately not defaulted to 0. The shipped default chat model is a
   * reasoning model, which rejects `temperature` outright and warns on every
   * call — so pinning it silently bought nothing and added noise. Pass it only
   * for a model that honours it.
   */
  temperature?: number;
  /** Stop each case after retrieval — nothing is generated and nothing graded. */
  retrievalOnly?: boolean;
}

/**
 * Runs the real engine against a real project's corpus: pgvector, the
 * configured provider, the shipped retrieval settings.
 *
 * This is where absolute numbers come from. The committed fixture cannot
 * produce them — its questions were written against documentation we control —
 * and a run here is only as honest as the questions it replays, which is why
 * they should be mined from real traffic rather than invented.
 */
export async function createProjectTarget(options: ProjectTargetOptions): Promise<{
  target: Target;
  k: number;
  /** What the engine was actually built with — for the report and baseline. */
  retrievalConfig: RetrievalProvenance;
  /** Fingerprint of the system prompt the engine was constructed with. */
  promptHash: string;
  resolveLabels: (dataset: Dataset) => Promise<Dataset>;
}> {
  const db = createDb(options.connectionString);

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, options.projectId))
    .limit(1);

  if (!project) {
    await db.$client.end();
    throw new Error(`no project with id ${options.projectId}`);
  }

  const { rerank, rerankModel, ...retrieval } = options.retrieval ?? {};
  // Read from the environment like the product does; the prompt hash below
  // is what tells two runs apart when it changes.
  const clarify = clarifyFromEnv(process.env);
  const verify = verifyFromEnv(process.env);
  // The project's own style paragraph (spec: answer-style) is part of the
  // prompt the product sends, so a run replays it and the hash records it.
  const answerStyle = project.answerStyle;
  // The product switches this per project from the project's reply; a run has
  // no reply to show and measures the rule alone (spec: own-data-fallback).
  const ownDataFallback = ownDataFromEnv(process.env);
  const engine = createEngine(
    {
      vectorStore: createVectorStore(db),
      // The product's corpus lookup, over the same rows (spec: answer-verification).
      lookupTerms: (orgId, projectId, terms) => lookupTerms(db, orgId, projectId, terms),
      ...createEngineModelDeps(
        {
          ...process.env,
          // The product configures the reranker from env; a sweep threads it
          // through the same door instead of mutating process.env.
          ...(rerank === undefined ? {} : { DESKBELL_RERANK: rerank }),
          ...(rerankModel === undefined ? {} : { DESKBELL_RERANK_MODEL: rerankModel }),
        },
        options.temperature === undefined ? {} : { temperature: options.temperature },
      ),
    },
    { retrieval, clarify, verify, ownDataFallback },
  );

  const retrievalConfig: RetrievalProvenance = {
    limit: retrieval.limit ?? RETRIEVAL_DEFAULTS.limit,
    minScore: retrieval.minScore ?? RETRIEVAL_DEFAULTS.minScore,
    mode: retrieval.mode ?? RETRIEVAL_DEFAULTS.mode,
    multiQuery: retrieval.multiQuery ?? RETRIEVAL_DEFAULTS.multiQuery,
    legDepth: retrieval.legDepth ?? RETRIEVAL_DEFAULTS.legDepth,
    efSearch: retrieval.efSearch ?? RETRIEVAL_DEFAULTS.efSearch,
    pool: retrieval.pool ?? RETRIEVAL_DEFAULTS.pool,
    maxPerDocument: retrieval.maxPerDocument ?? RETRIEVAL_DEFAULTS.maxPerDocument,
    order: retrieval.order ?? RETRIEVAL_DEFAULTS.order,
    rerank: rerank ?? "off",
    ...(rerank === "llm" && rerankModel ? { rerankModel } : {}),
  };

  const inner = createEngineTarget({
    engine,
    orgId: project.orgId,
    projectId: project.id,
    name: `project:${project.id}`,
    answerStyle,
    retrievalOnly: options.retrievalOnly,
    onUnsupportedTerms: options.onUnsupportedTerms,
  });

  return {
    k: retrievalConfig.limit,
    retrievalConfig,
    // From the module that built the engine: the harness cannot read a prompt
    // back out of one, and a hash guessed elsewhere would be a guess.
    promptHash: promptFingerprint(
      buildSystemPrompt({ clarify, verify, answerStyle, ownData: ownDataFallback }),
    ),
    // Bound to the pool this target already opened, so resolving labels costs
    // no second connection and cannot outlive the target.
    resolveLabels: (dataset: Dataset) => resolveUrlLabels(db, project.id, dataset),
    target: {
      name: inner.name,
      ask: inner.ask,
      async close() {
        // The pool keeps the process alive otherwise, and a CLI that hangs
        // after printing its report reads as a crash.
        await db.$client.end();
      },
    },
  };
}
