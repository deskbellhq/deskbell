import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  type AnswerEngine,
  buildSystemPrompt,
  chunkText,
  createEngine,
  type EngineDeps,
  isSupportedBy,
  REFUSAL_SENTINEL,
} from "@deskbell/core";
import { promptFingerprint } from "../prompt";
import { createMemoryVectorStore, type MemoryChunk } from "./memory-store";
import { embedText, generateFromContext } from "./stub-model";

export const FIXTURE_ORG_ID = "org_fixture";
export const FIXTURE_PROJECT_ID = "proj_fixture";

/**
 * Smaller than production defaults on purpose: the fixture documents are short,
 * and one chunk per document would make retrieval a document lookup rather than
 * a ranking, which is the part worth measuring.
 */
export const FIXTURE_CHUNKING = { targetChars: 400, maxChars: 600, overlapChars: 80 };

export const FIXTURE_RETRIEVAL = {
  limit: 8,
  /**
   * Lower than the product default because the stub embedder is a lexical
   * bag-of-words, not a trained model — its similarity scores live on a
   * different scale entirely. Comparing this number to the production floor
   * would be meaningless. It is set low enough that questions the corpus does
   * not cover still retrieve something weak, so the refusal has to come from
   * the grounding contract rather than from an empty result — which is the
   * path that actually ships.
   */
  minScore: 0.2,
};

const CORPUS_DIR = fileURLToPath(new URL("./corpus/", import.meta.url));

export interface FixtureDocument {
  documentId: string;
  title: string;
  content: string;
}

function titleOf(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() ?? fallback;
}

export async function loadFixtureCorpus(): Promise<FixtureDocument[]> {
  const files = (await readdir(CORPUS_DIR)).filter((f) => f.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (file) => {
      const content = await readFile(new URL(file, `file://${CORPUS_DIR}`), "utf8");
      const documentId = file.replace(/\.md$/, "");
      return { documentId, title: titleOf(content, documentId), content };
    }),
  );
}

export async function buildFixtureChunks(): Promise<MemoryChunk[]> {
  const documents = await loadFixtureCorpus();
  const chunks: MemoryChunk[] = [];

  for (const doc of documents) {
    // The real chunker, not a fixture-local one: it lives in core precisely so
    // the harness measures the chunking the product ships (D8).
    const pieces = chunkText(doc.content, FIXTURE_CHUNKING);
    for (const [index, content] of pieces.entries()) {
      chunks.push({
        chunkId: `${doc.documentId}#${index}`,
        documentId: doc.documentId,
        title: doc.title,
        content,
        embedding: embedText(`${doc.title}\n${content}`),
      });
    }
  }

  return chunks;
}

export interface FixtureOptions {
  /**
   * Swaps the stub generator for a real model while keeping the controlled
   * corpus and the in-memory store.
   *
   * This is the only way to evaluate anything about a model's BEHAVIOUR against
   * content we author — prompt-injection resistance above all. The stub is
   * extractive and has no instructions to disobey, so it passes every injection
   * case unconditionally; a real deployment's corpus, meanwhile, contains no
   * payload to test against. Neither half works alone.
   */
  generate?: EngineDeps["generate"];
  /**
   * Let the engine ask clarifying questions (spec: clarifying-questions).
   * Only meaningful with a real generator: the stub never asks. Absent, the
   * prompt and its fingerprint are exactly the fixture's.
   */
  clarify?: boolean;
  /**
   * Check the names an answer asserts against the corpus (spec:
   * answer-verification), over the in-memory chunks. Only meaningful with a
   * real generator: the stub emits no bold and no code. Absent, the prompt
   * and its fingerprint are exactly the fixture's.
   */
  verify?: boolean;
  /**
   * Refuse a question about the visitor's own data with its own reason
   * (spec: own-data-fallback). Only meaningful with a real generator: the
   * stub never emits the sentinel. Absent, the prompt and its fingerprint
   * are exactly the fixture's.
   */
  ownData?: boolean;
}

export interface Fixture {
  engine: AnswerEngine;
  orgId: string;
  projectId: string;
  k: number;
  /** Fingerprint of the prompt this engine was built with, for the report. */
  promptHash: string;
  chunks: MemoryChunk[];
}

/**
 * The whole fixture: real chunker, real engine, real retrieval interface — only
 * the model and the database are stubbed. Deterministic end to end.
 */
export async function buildFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const chunks = await buildFixtureChunks();
  const vectorStore = createMemoryVectorStore(chunks);
  // What the product's lookup does over Postgres, over the chunks in memory:
  // a name is in the corpus when any chunk's title or content contains it.
  const texts = chunks.map((c) => `${c.title}\n${c.content}`);

  const engine = createEngine(
    {
      vectorStore,
      async lookupTerms(_orgId, _projectId, terms) {
        return new Set(terms.filter((term) => isSupportedBy(term, texts)));
      },
      // The embedder stays lexical even with a real generator: retrieval over
      // five documents does not need a trained model, and holding it fixed keeps
      // the model the only thing that changed.
      async embed(text) {
        return { embedding: embedText(text), tokens: text.length };
      },
      generate:
        options.generate ??
        async function* stub({ context, message, onUsage }) {
          const answer = generateFromContext(context, message, REFUSAL_SENTINEL);
          // Emitted in pieces so the sentinel's prefix-buffering runs for real:
          // a refusal that arrives as one token would never exercise it.
          for (const piece of answer.split(/(?<=\s)/)) yield piece;
          onUsage?.({ input: context.length, output: answer.length });
        },
    },
    {
      retrieval: FIXTURE_RETRIEVAL,
      ...(options.clarify ? { clarify: true } : {}),
      ...(options.verify ? { verify: true } : {}),
      ...(options.ownData ? { ownDataFallback: true } : {}),
    },
  );

  return {
    engine,
    orgId: FIXTURE_ORG_ID,
    projectId: FIXTURE_PROJECT_ID,
    k: FIXTURE_RETRIEVAL.limit,
    // Reported by the thing that built the engine: nothing downstream can see
    // which prompt an engine was constructed with.
    promptHash: promptFingerprint(
      buildSystemPrompt({
        clarify: options.clarify,
        verify: options.verify,
        ownData: options.ownData,
      }),
    ),
    chunks,
  };
}
