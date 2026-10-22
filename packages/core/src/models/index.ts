import { createHmac } from "node:crypto";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { EMBEDDING_DIMENSIONS } from "@deskbell/db";
import {
  defaultSettingsMiddleware,
  dynamicTool,
  embed,
  embedMany,
  generateText,
  jsonSchema,
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  streamText,
  type ToolSet,
  wrapLanguageModel,
} from "ai";
import type { EngineDeps, EngineTool, GenerationPart } from "../engine";
import { type AnswerDrafter, createAnswerDrafter } from "./answer-drafter";
import { type ConversationTitler, createConversationTitler } from "./conversation-titler";
import { createFeedbackSummarizer, type FeedbackSummarizer } from "./feedback-summarizer";
import { createGapAnalyst, type GapAnalyst } from "./gap-analyst";
import { createQueryPlanner } from "./query-planner";
import { createReranker } from "./reranker";

/**
 * THE model-config module (root AGENTS rule 8; D4/D13): the ONLY place in the
 * repo that imports provider SDKs. Everything else consumes the returned
 * functions. Exposed via the `@deskbell/core/models` subpath only — the engine
 * barrel never re-exports it, so the engine stays provider-free.
 *
 * Model ids are `provider/model` strings from env:
 *   DESKBELL_CHAT_MODEL       (default openai/gpt-5-mini)
 *   DESKBELL_EMBEDDING_MODEL  (default openai/text-embedding-3-small)
 *   DESKBELL_JUDGE_MODEL      (default: whatever DESKBELL_CHAT_MODEL is)
 *   DESKBELL_PLANNER_MODEL    (default: whatever DESKBELL_CHAT_MODEL is)
 *   DESKBELL_RERANK_MODEL     (llm: defaults to the chat model; local: a
 *                              HF-hub cross-encoder id — see ./reranker)
 *   DESKBELL_GAP_ANALYST_MODEL (default: whatever DESKBELL_CHAT_MODEL is;
 *                              see ./gap-analyst)
 *   DESKBELL_REASONING_EFFORT  low (default) | minimal | medium | high |
 *                              provider — how hard a reasoning model may
 *                              think on the answer path; see reasoningEffort
 *   DESKBELL_NOTIFICATION_SUMMARY  model (default) | none — whether a
 *                              notification carries a one-sentence model
 *                              summary; see notificationSummaryMode
 *
 * Wired providers:
 *   openai/*      chat + embeddings          OPENAI_API_KEY
 *   anthropic/*   chat only — Anthropic has  ANTHROPIC_API_KEY
 *                 no embeddings API; pair
 *                 with openai/* or ollama/*
 *   google/*      chat + embeddings          GOOGLE_GENERATIVE_AI_API_KEY
 *                 (embeddings pinned to the
 *                 schema's dimension, see
 *                 embeddingModel)
 *   ollama/*      chat + embeddings, fully   OLLAMA_BASE_URL
 *                 local, no hosted key       (default http://localhost:11434)
 *
 * Credentials and endpoints are read from the environment by the provider
 * layer itself, never passed through app code. Ollama speaks the OpenAI
 * -compatible API, so it runs through the official openai-compatible
 * provider against `$OLLAMA_BASE_URL/v1` — which is also the escape hatch
 * for anything else that speaks that protocol (vLLM, LM Studio, llama.cpp):
 * point OLLAMA_BASE_URL at it. Ollama is a service the operator already
 * runs; it is NOT in docker-compose and never becomes a self-host
 * dependency (D11 — Postgres only).
 */

const DEFAULT_CHAT_MODEL = "openai/gpt-5-mini";
const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export function parseModelId(id: string): { provider: string; model: string } {
  const slash = id.indexOf("/");
  const provider = slash === -1 ? "" : id.slice(0, slash);
  const model = slash === -1 ? "" : id.slice(slash + 1);
  if (!provider || !model) {
    throw new Error(
      `Invalid model id "${id}" — expected "provider/model", e.g. "openai/gpt-5-mini"`,
    );
  }
  return { provider, model };
}

function unsupported(provider: string): never {
  throw new Error(
    `Unsupported model provider "${provider}" — wired providers are "openai/*", ` +
      '"anthropic/*" (chat), "google/*" and "ollama/*"; others land by adding a ' +
      "case in packages/core/src/models (D4).",
  );
}

/**
 * Constructed per call, not at module load: the base URL is env-dependent and
 * construction is cheap. Ollama's OpenAI-compatible surface lives under /v1;
 * appended here so the env var stays the address Ollama itself prints.
 */
function ollama() {
  const base = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/+$/, "");
  return createOpenAICompatible({
    name: "ollama",
    baseURL: base.endsWith("/v1") ? base : `${base}/v1`,
  });
}

/**
 * How hard a reasoning model may think before its first visible token.
 *
 * A reasoning model left at its provider default deliberates for hundreds of
 * hidden tokens before answering, and every one of them is paid for and waited
 * on: with the default chat model the visitor sees nothing for eight to eleven
 * seconds on a grounded question whose answer is one short paragraph, and a
 * refusal that emits nothing at all takes as long. Grounded QA is not a
 * deliberation task — the context is in the prompt — so the answer path pins
 * the effort down and measures rather than trusts the provider's default.
 *
 * "low", not "minimal": at minimal the default chat model refuses questions
 * the context answers (two of three probed, where low answered all three),
 * and a false refusal is worse than four seconds. Low halves the wait; the
 * rest of the way is a non-reasoning model, which is a model choice, not an
 * effort setting.
 *
 * "provider" sends nothing and leaves the model at whatever the provider
 * decides. Today only `openai/*` has the concept; on other providers every
 * value is a no-op, and the OpenAI provider itself ignores it (with a warning)
 * for non-reasoning models, so a `gpt-4.1-mini` deployment needs no change.
 *
 * "none" switches reasoning off where the model allows it, which is the
 * fastest a reasoning model gets. Whether a model allows it is the model's
 * call, not ours: the newer ones accept it, the older ones reject the request
 * with a 400, and an operator who sets it on a model that refuses sees that
 * error on the first question. Deskbell passes it through rather than
 * second-guessing the provider's model list.
 */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "provider";
const DEFAULT_REASONING_EFFORT: ReasoningEffort = "low";

export function reasoningEffort(env: NodeJS.ProcessEnv = process.env): ReasoningEffort {
  const raw = env.DESKBELL_REASONING_EFFORT?.trim().toLowerCase();
  if (!raw) return DEFAULT_REASONING_EFFORT;
  if (raw === "none" || raw === "minimal" || raw === "low") return raw;
  if (raw === "medium" || raw === "high" || raw === "provider") return raw;
  console.warn(
    `[models] unknown DESKBELL_REASONING_EFFORT "${raw}" — using "${DEFAULT_REASONING_EFFORT}"`,
  );
  return DEFAULT_REASONING_EFFORT;
}

/**
 * Whether the widget shows the model's reasoning beside its tool calls
 * (spec: activity-disclosure). Off unless `DESKBELL_SHOW_REASONING` is set,
 * because reasoning is written for the model, not the visitor: it names the
 * refusal sentinel, the context, the tools, and whatever the prompt says —
 * a deployment turns it on knowing that. The ask route drops the events
 * when this is off, whatever the model emitted.
 */
export function reasoningVisible(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.DESKBELL_SHOW_REASONING?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/**
 * The provider options that pin the effort and, when reasoning is shown,
 * ask for its summary — or undefined when nothing should be sent. Only
 * `openai/*` has either setting; its reasoning models emit no reasoning text
 * at all unless a summary is requested, so the request rides on the same
 * flag as the display. Exported for the test: the wrapped model is opaque,
 * this is not.
 */
export function reasoningProviderOptions(
  provider: string,
  effort: ReasoningEffort,
  visible = false,
): Record<string, Record<string, string>> | undefined {
  if (provider !== "openai") return undefined;
  const openai: Record<string, string> = {};
  if (effort !== "provider") openai.reasoningEffort = effort;
  if (visible) openai.reasoningSummary = "auto";
  return Object.keys(openai).length > 0 ? { openai } : undefined;
}

/**
 * The effort rides on the model, not on each call: the planner, the reranker
 * and the answer all take a model factory, and pinning it here means none of
 * them can forget. Default "provider" so that the callers which deliberately
 * leave the model alone — the judge, the gap analyst — read as such.
 */
function languageModel(id: string, effort: ReasoningEffort = "provider", visible = false) {
  const { provider, model } = parseModelId(id);
  const base = (() => {
    switch (provider) {
      case "openai":
        return openai(model);
      case "anthropic":
        return anthropic(model);
      case "google":
        return google(model);
      case "ollama":
        return ollama().chatModel(model);
      default:
        return unsupported(provider);
    }
  })();
  const providerOptions = reasoningProviderOptions(provider, effort, visible);
  if (!providerOptions) return base;
  return wrapLanguageModel({
    model: base,
    middleware: defaultSettingsMiddleware({ settings: { providerOptions } }),
  });
}

/** What a query embedding and a document embedding are for, where a provider distinguishes them. */
type EmbeddingUse = "query" | "document";

/**
 * Per-call provider options for an embedding model, or undefined when the
 * provider takes none. Google's embedding models default to 3072 dimensions
 * and accept a smaller width on request, so the width is pinned to the
 * schema's `vector` column; they also embed queries and documents differently
 * when told which is which, which is the documented way to use them for
 * retrieval.
 */
export function embeddingProviderOptions(
  provider: string,
  use: EmbeddingUse,
): Record<string, Record<string, string | number>> | undefined {
  if (provider === "google") {
    return {
      google: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
        taskType: use === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
      },
    };
  }
  return undefined;
}

function embeddingModel(id: string) {
  const { provider, model } = parseModelId(id);
  switch (provider) {
    case "openai":
      return openai.embedding(model);
    case "anthropic":
      throw new Error(
        `Cannot embed with "${id}" — Anthropic has no embeddings API. Keep ` +
          "DESKBELL_CHAT_MODEL on anthropic/* and point DESKBELL_EMBEDDING_MODEL " +
          'at "openai/*", "google/*" or "ollama/*".',
      );
    case "google":
      return google.textEmbeddingModel(model);
    case "ollama":
      return ollama().textEmbeddingModel(model);
    default:
      return unsupported(provider);
  }
}

/**
 * Generation settings the caller may pin. Nothing is set by default — the
 * provider's own defaults are the product's behaviour. An eval run pins
 * `temperature: 0`, because two runs of one dataset disagreeing for no reason
 * makes a regression gate worthless (spec: eval-harness, D8).
 */
export interface GenerationOptions {
  temperature?: number;
  seed?: number;
}

/**
 * How far a turn with tools may go (spec: mcp-actions). Read from the
 * environment once per deps object; every value has a default, and a bad
 * value warns and keeps the default rather than guessing.
 *
 *   DESKBELL_ACTION_MAX_STEPS         model steps per turn (default 4)
 *   DESKBELL_ACTION_TIMEOUT_MS        per tool call (default 30000; a tool backed by a
 *                                     model of its own takes fifteen seconds and more)
 *   DESKBELL_ACTION_RESULT_MAX_CHARS  of a result shown to the model (default 8000)
 *
 * The approval secret is derived from BETTER_AUTH_SECRET: the SDK signs each
 * confirmation request with it and refuses a replayed or altered one. No
 * secret means unsigned approvals, which is only acceptable in tests.
 */
export interface ActionOptions {
  maxSteps: number;
  timeoutMs: number;
  resultMaxChars: number;
  approvalSecret?: string;
}

export const ACTION_DEFAULTS: ActionOptions = Object.freeze({
  maxSteps: 4,
  timeoutMs: 30_000,
  resultMaxChars: 8000,
});

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isInteger(n) && n > 0) return n;
  console.warn(`[models] ignoring ${name}="${raw}" — using ${fallback}`);
  return fallback;
}

export function actionOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): ActionOptions {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  return {
    maxSteps: positiveInt(env, "DESKBELL_ACTION_MAX_STEPS", ACTION_DEFAULTS.maxSteps),
    timeoutMs: positiveInt(env, "DESKBELL_ACTION_TIMEOUT_MS", ACTION_DEFAULTS.timeoutMs),
    resultMaxChars: positiveInt(
      env,
      "DESKBELL_ACTION_RESULT_MAX_CHARS",
      ACTION_DEFAULTS.resultMaxChars,
    ),
    ...(secret
      ? {
          approvalSecret: createHmac("sha256", secret)
            .update("deskbell:tool-approval")
            .digest("base64url"),
        }
      : {}),
  };
}

/**
 * What the model reads back from a tool: the result as text, cut to the
 * limit and fenced so the prompt can name it as material. A structured
 * result is serialised; a string is kept. Exported for its test.
 */
export function toolResultForModel(tool: string, output: unknown, maxChars: number): string {
  const text =
    typeof output === "string"
      ? output
      : (() => {
          try {
            return JSON.stringify(output) ?? "";
          } catch {
            return "";
          }
        })();
  const body = text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
  return `<tool_result tool="${tool}">\n${body}\n</tool_result>`;
}

/**
 * The engine's tools as the AI SDK sees them. Every input schema comes from
 * the server that declared the tool, so it is JSON Schema rather than zod;
 * `additionalProperties: false` keeps the model from inventing fields. The
 * per-call timeout is combined with the request's own signal.
 */
function toolSet(tools: EngineTool[], actions: ActionOptions): ToolSet {
  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      dynamicTool({
        description: tool.description,
        inputSchema: jsonSchema({
          ...tool.inputSchema,
          properties: (tool.inputSchema.properties as Record<string, unknown> | undefined) ?? {},
          additionalProperties: false,
        } as Parameters<typeof jsonSchema>[0]),
        execute: async (input, { abortSignal }) => {
          const signals = [AbortSignal.timeout(actions.timeoutMs)];
          if (abortSignal) signals.push(abortSignal);
          return tool.execute(input, { signal: AbortSignal.any(signals) });
        },
        toModelOutput: ({ output }) => ({
          type: "text",
          value: toolResultForModel(tool.name, output, actions.resultMaxChars),
        }),
      }),
    ]),
  );
}

/**
 * What the model is told once the step budget has run out on a tool call:
 * the results it has, and that the answer must come now. Plain text, so the
 * request that carries it needs no tool definitions.
 */
const STEPS_EXHAUSTED_PROMPT =
  "Those are the results of the tools you called. No further tool call is possible in " +
  "this turn. Answer the question now from the context and these results. If they do " +
  "not answer it, say plainly what was found and what was not.";

/** A model a test hands in; production builds its own from the environment. */
export interface ModelOverrides {
  chat?: LanguageModel;
}

/** Engine-facing deps for the ask path (apps/web). */
export function createEngineModelDeps(
  env: NodeJS.ProcessEnv = process.env,
  generation: GenerationOptions = {},
  actions: ActionOptions = actionOptionsFromEnv(env),
  overrides: ModelOverrides = {},
): Pick<EngineDeps, "generate" | "embed" | "planQuery" | "rerank"> {
  const chatId = chatModelId(env);
  // One effort for the whole visitor path: what the planner and the reranker
  // spend thinking is waited on exactly as the answer is.
  const effort = reasoningEffort(env);
  const answerPathModel = (id: string) => languageModel(id, effort);
  // Only the chat model's reasoning reaches the visitor, so only it is asked
  // for a summary; the planner and the reranker would pay for text nobody reads.
  const chat = overrides.chat ?? languageModel(chatId, effort, reasoningVisible(env));
  const embeddingId = embeddingModelId(env);
  const embedder = embeddingModel(embeddingId);
  const embedOptions = embeddingProviderOptions(parseModelId(embeddingId).provider, "query");

  return {
    planQuery: createQueryPlanner(answerPathModel, env, chatId),
    rerank: createReranker(answerPathModel, env, chatId),
    async embed(text) {
      const result = await embed({ model: embedder, value: text, providerOptions: embedOptions });
      // Not every embeddings API reports usage (Google's does not); a NaN here
      // would reach the daily token budget as a number that compares as nothing.
      const tokens = result.usage?.tokens;
      return { embedding: result.embedding, tokens: Number.isFinite(tokens) ? tokens : 0 };
    },
    async *generate({ system, context, message, history, onUsage, tools, resume }) {
      const prior: ModelMessage[] = (history ?? []).map((turn) => ({
        role: turn.role,
        content: turn.content,
      }));
      // Prior turns as real messages, with the context attached to the current
      // one. Without them the model cannot resolve a reference the visitor
      // clearly expects it to — and retrieval has already been given the
      // resolved question separately, so the two halves agree.
      //
      // A resumed turn replays the paused step's messages verbatim and answers
      // its approval request; the SDK verifies the signature before it runs
      // the tool (spec: mcp-actions).
      const messages: ModelMessage[] = resume
        ? [
            ...prior,
            ...(resume.messages as ModelMessage[]),
            {
              role: "tool",
              content: [
                {
                  type: "tool-approval-response",
                  approvalId: resume.approval.approvalId,
                  approved: resume.approval.approved,
                  ...(resume.approval.reason ? { reason: resume.approval.reason } : {}),
                },
              ],
            },
          ]
        : [...prior, { role: "user", content: `Context:\n${context}\n\nQuestion: ${message}` }];
      const policies = new Map((tools ?? []).map((tool) => [tool.name, tool.policy]));
      const settings = {
        ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
        ...(generation.seed === undefined ? {} : { seed: generation.seed }),
      };
      const result = streamText({
        model: chat,
        system,
        messages,
        ...(tools && tools.length > 0
          ? {
              tools: toolSet(tools, actions),
              stopWhen: stepCountIs(actions.maxSteps),
              toolApproval: ({ toolCall }) =>
                policies.get(toolCall.toolName) === "confirm" ? "user-approval" : undefined,
              ...(actions.approvalSecret
                ? { experimental_toolApprovalSecret: actions.approvalSecret }
                : {}),
            }
          : {}),
        ...settings,
      });
      let paused = false;
      /** How the last step ended; "tool-calls" at the end means the budget ran out on one. */
      let lastFinish: string | undefined;
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            yield part.text;
            break;
          case "reasoning-delta":
            yield { type: "reasoning", value: part.text } satisfies GenerationPart;
            break;
          case "tool-call":
            yield {
              type: "tool-call",
              callId: part.toolCallId,
              tool: part.toolName,
              input: part.input,
            } satisfies GenerationPart;
            break;
          case "tool-result":
            yield {
              type: "tool-result",
              callId: part.toolCallId,
              tool: part.toolName,
              output: part.output,
            } satisfies GenerationPart;
            break;
          case "tool-error":
            yield {
              type: "tool-result",
              callId: part.toolCallId,
              tool: part.toolName,
              output: null,
              error: part.error instanceof Error ? part.error.message : String(part.error),
            } satisfies GenerationPart;
            break;
          case "tool-approval-request":
            if (part.isAutomatic) break;
            paused = true;
            yield {
              type: "approval",
              callId: part.toolCall.toolCallId,
              approvalId: part.approvalId,
              tool: part.toolCall.toolName,
              input: part.toolCall.input,
              ...(part.signature ? { signature: part.signature } : {}),
            } satisfies GenerationPart;
            break;
          case "finish-step":
            lastFinish = part.finishReason;
            yield {
              type: "step-end",
              finish:
                part.finishReason === "stop" ||
                part.finishReason === "tool-calls" ||
                part.finishReason === "length"
                  ? part.finishReason
                  : "other",
            } satisfies GenerationPart;
            break;
          case "error":
            throw part.error;
          default:
            break;
        }
      }
      if (paused) {
        // The messages of the step that paused, for the host to store and
        // hand back as `resume.messages`.
        yield { type: "paused", messages: await result.responseMessages } satisfies GenerationPart;
      }
      // The step budget ran out on a call: the model spent its last allowed
      // step calling a tool, the tool ran, and no step was left to write the
      // answer. Left there, the turn ends with the tool's output and no text,
      // and the visitor gets an empty message. One more generation, with no
      // tools at all, turns what the calls returned into an answer. It is
      // given the results as plain text rather than the step messages: a
      // request that carries tool parts must also define the tools, and the
      // point of this step is that nothing can be called.
      let finalUsage: ReturnType<typeof streamText>["totalUsage"] | undefined;
      if (!paused && lastFinish === "tool-calls" && tools && tools.length > 0) {
        const steps = await result.steps;
        const results = steps
          .flatMap((step) => step.toolResults)
          .map((r) => toolResultForModel(r.toolName, r.output, actions.resultMaxChars));
        const final = streamText({
          model: chat,
          system,
          messages: [
            // The turns with text content: prior history and the question with
            // its context. Tool parts, and a resumed step's messages, stay out.
            ...messages.filter((m) => typeof m.content === "string"),
            { role: "user", content: `${results.join("\n")}\n\n${STEPS_EXHAUSTED_PROMPT}` },
          ],
          ...settings,
        });
        for await (const part of final.fullStream) {
          if (part.type === "text-delta") yield part.text;
          else if (part.type === "error") throw part.error;
        }
        finalUsage = final.totalUsage;
      }
      // After the stream, so the provider has reported totals. The engine drains
      // this generator even on a refusal, so this always runs for a request the
      // model actually saw (spec: widget-abuse-protection).
      if (onUsage) {
        const usage = await result.totalUsage;
        const extra = finalUsage ? await finalUsage : undefined;
        onUsage({
          input: (usage.inputTokens ?? 0) + (extra?.inputTokens ?? 0),
          output: (usage.outputTokens ?? 0) + (extra?.outputTokens ?? 0),
        });
      }
    },
  };
}

/**
 * The chat model this deployment is configured to use right now. Exported so
 * the answer a row records as "written by" and the model that actually wrote
 * it cannot drift apart (spec: answer-signal).
 */
export function chatModelId(env: NodeJS.ProcessEnv = process.env): string {
  return env.DESKBELL_CHAT_MODEL ?? DEFAULT_CHAT_MODEL;
}
/**
 * The embedding model this deployment is configured to use right now.
 * Exported so the dashboard can compare it against what rows actually carry
 * and offer a re-index when they diverge (spec: ingestion-pipeline) — without
 * duplicating the default.
 */
export function embeddingModelId(env: NodeJS.ProcessEnv = process.env): string {
  return env.DESKBELL_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
}

/**
 * Whether a configured model's provider has what it needs to be called —
 * by presence of its key variable, never by trying it (spec:
 * overview-getting-started). The dashboard shows this on first run, where a
 * missing key is the one failure nothing else names: the crawl succeeds, the
 * embed step fails, and the source sits in `syncing` forever. Presence, not
 * validity: a probe would cost a request on every page load, and a rejected
 * key already fails loudly in the worker log.
 */
export interface ProviderStatus {
  /** The configured id, e.g. "openai/gpt-5-mini". */
  id: string;
  provider: string;
  /** The variable the provider reads; null when none is needed (ollama) or the provider is unknown. */
  keyEnv: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "GOOGLE_GENERATIVE_AI_API_KEY" | null;
  /** True when no key is needed or the key variable is set and non-blank. */
  configured: boolean;
}

const PROVIDER_KEY_ENV: Record<string, ProviderStatus["keyEnv"]> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  ollama: null,
};

function providerStatus(id: string, env: NodeJS.ProcessEnv): ProviderStatus {
  const { provider } = parseModelId(id);
  if (!(provider in PROVIDER_KEY_ENV)) return { id, provider, keyEnv: null, configured: false };
  const keyEnv = PROVIDER_KEY_ENV[provider] ?? null;
  const configured = keyEnv === null || Boolean(env[keyEnv]?.trim());
  return { id, provider, keyEnv, configured };
}

export function modelProviderStatus(env: NodeJS.ProcessEnv = process.env): {
  chat: ProviderStatus;
  embedding: ProviderStatus;
} {
  return {
    chat: providerStatus(chatModelId(env), env),
    embedding: providerStatus(embeddingModelId(env), env),
  };
}

/** Batch embedder for the ingestion worker. */
export function createEmbedder(env: NodeJS.ProcessEnv = process.env): {
  modelId: string;
  embedMany(values: string[]): Promise<number[][]>;
} {
  const modelId = embeddingModelId(env);
  const model = embeddingModel(modelId);
  const providerOptions = embeddingProviderOptions(parseModelId(modelId).provider, "document");
  return {
    modelId,
    async embedMany(values) {
      if (values.length === 0) return [];
      const result = await embedMany({ model, values, providerOptions });
      return result.embeddings;
    },
  };
}

/**
 * Completion access for the eval harness's LLM judge (D8). It lives here rather
 * than in `packages/evals` for the same reason everything else does: this is the
 * only module permitted to import a provider SDK (root rule 8, D4/D13).
 *
 * A judge should not be the model under test: asked to mark its own homework, a
 * model grades its own failure modes as successes, because the same blind spot
 * produced and then reviewed the answer. `DESKBELL_JUDGE_MODEL` points it
 * elsewhere. It still falls back to the answering model so that `--judge llm`
 * works without extra setup, but `targetModelId` is returned so the caller can
 * say so — a self-graded number must never travel without that caveat attached.
 *
 * Nothing is pinned by default: reasoning models reject `temperature` and warn
 * on every call, so a caller that knows its model honours sampling settings
 * passes them explicitly.
 */
export function createJudgeDeps(
  env: NodeJS.ProcessEnv = process.env,
  generation: GenerationOptions = {},
): {
  modelId: string;
  /** The model being evaluated. Equal to modelId means the judge is self-grading. */
  targetModelId: string;
  complete(opts: { system: string; prompt: string }): Promise<string>;
} {
  const targetModelId = chatModelId(env);
  const modelId = env.DESKBELL_JUDGE_MODEL ?? targetModelId;
  const model = languageModel(modelId);
  return {
    modelId,
    targetModelId,
    async complete({ system, prompt }) {
      const result = await generateText({
        model,
        system,
        prompt,
        ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
        ...(generation.seed === undefined ? {} : { seed: generation.seed }),
      });
      return result.text;
    },
  };
}

/**
 * The gap analyst for the worker (spec: gap-analysis). Separate from
 * `createEngineModelDeps` on purpose: the answer path must never construct
 * it, and the worker must not construct the answer path's deps to get it.
 */
export function createGapAnalystDeps(env: NodeJS.ProcessEnv = process.env): GapAnalyst {
  return createGapAnalyst(languageModel, env, chatModelId(env));
}
export type { GapAnalysis, GapAnalysisInput, GapAnalyst } from "./gap-analyst";

/**
 * The answer drafter for the dashboard (spec: answer-drafting). Same shape
 * as the analyst and kept out of `createEngineModelDeps` for the same
 * reason: the answer path must never construct it. Unlike the analyst it is
 * called from a server action rather than the worker, because one person is
 * waiting at one textarea.
 */
export function createAnswerDrafterDeps(env: NodeJS.ProcessEnv = process.env): AnswerDrafter {
  return createAnswerDrafter(languageModel, env, chatModelId(env));
}
export type { AnswerDraft, AnswerDrafter, AnswerDraftInput } from "./answer-drafter";

/**
 * The conversation titler for the worker (spec:
 * conversation-context-and-titles). Same shape as the analyst: built for the
 * worker, never on the answer path, model constructed on first use.
 */
export function createConversationTitlerDeps(
  env: NodeJS.ProcessEnv = process.env,
): ConversationTitler {
  return createConversationTitler(languageModel, chatModelId(env));
}
export type { ConversationTitler } from "./conversation-titler";

/**
 * The feedback summarizer for the worker (spec: project-notifications).
 * Same shape as the titler: built for the worker, never on the answer path,
 * model constructed on first use.
 */
export function createFeedbackSummarizerDeps(
  env: NodeJS.ProcessEnv = process.env,
): FeedbackSummarizer {
  return createFeedbackSummarizer(languageModel, chatModelId(env));
}
export type { FeedbackSummarizer } from "./feedback-summarizer";

/**
 * Whether notifications spend a model call on their summary. "none" keeps
 * the notification and drops the sentence: the one part of the feature that
 * costs tokens must be switchable without switching the feature off.
 */
export type NotificationSummaryMode = "model" | "none";
export function notificationSummaryMode(
  env: NodeJS.ProcessEnv = process.env,
): NotificationSummaryMode {
  const raw = env.DESKBELL_NOTIFICATION_SUMMARY?.trim().toLowerCase();
  if (!raw || raw === "model") return "model";
  if (raw === "none") return "none";
  console.warn(`[models] unknown DESKBELL_NOTIFICATION_SUMMARY "${raw}" — using "model"`);
  return "model";
}
