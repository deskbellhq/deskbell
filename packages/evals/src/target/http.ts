import type { AnswerEvent } from "@deskbell/shared";
import type { EvalCase, Target, TargetAnswer } from "../types";

export interface HttpTargetOptions {
  /** Base URL of a running instance, e.g. http://localhost:3000 */
  apiUrl: string;
  projectKey: string;
  /**
   * Sent as the Origin header. `/api/v1/ask` refuses a POST without one, and
   * in production refuses one that is not allowlisted — so an eval run against
   * a real deployment must be run from an origin that deployment trusts.
   */
  origin: string;
  sessionId?: string;
  name?: string;
  now?: () => number;
  /**
   * How many times to wait out a 429 before giving up. An eval run replays
   * dozens of questions from one IP as fast as it can, which is precisely the
   * traffic shape the abuse guard exists to stop — so being rate limited is the
   * normal case here, not an error.
   */
  maxRetries?: number;
  /** Refuse to wait longer than this for one case. */
  maxRetryWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_MAX_RETRY_WAIT_MS = 90_000;

/**
 * Drives a running instance over its public API.
 *
 * This is also the third-party seam: any other answering system can be
 * evaluated by implementing `Target` directly — the interface is the contract,
 * and the harness does not care what is behind it.
 *
 * What this target CANNOT see: retrieval. The wire protocol reports citations,
 * not the chunks retrieval ranked, and citation snippets are truncated — so
 * retrieval metrics and groundedness come back unassessed rather than
 * estimated from partial text. Use the in-process target for those.
 */
export function createHttpTarget(opts: HttpTargetOptions): Target {
  const now = opts.now ?? (() => performance.now());
  const sessionId = opts.sessionId ?? "eval-harness";
  const url = `${opts.apiUrl.replace(/\/$/, "")}/api/v1/ask`;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxRetryWaitMs = opts.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function post(body: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", origin: opts.origin },
        body,
      });

      if (response.status !== 429) return response;

      // The guard tells us exactly how long to wait; guessing would either
      // hammer it further or idle for no reason.
      const retryAfterMs = Number(response.headers.get("retry-after") ?? "1") * 1000;
      if (attempt >= maxRetries || retryAfterMs > maxRetryWaitMs) {
        throw new Error(
          `rate limited after ${attempt + 1} attempt(s), and the server asks for ${Math.round(retryAfterMs / 1000)}s. ` +
            "An eval run looks like abuse to the request guard. Either lower --concurrency, " +
            "or raise DESKBELL_RATE_LIMIT_ASK_PER_MIN / _PER_HOUR and DESKBELL_MAX_CONCURRENT_ASKS " +
            "on the instance under test.",
        );
      }
      await sleep(retryAfterMs);
    }
  }

  return {
    name: opts.name ?? `http:${opts.apiUrl}`,
    async ask(evalCase: EvalCase): Promise<TargetAnswer> {
      // The server loads history by conversation id; the scripted turns a
      // follow-up case carries cannot be sent, and replaying them one by one
      // would substitute the server's own answers for the scripted ones.
      if (evalCase.history?.length) {
        throw new Error(
          `case ${evalCase.id} carries history, which the HTTP target cannot replay — run it with --project or against the fixture`,
        );
      }
      const started = now();
      const response = await post(
        JSON.stringify({
          projectKey: opts.projectKey,
          sessionId,
          message: evalCase.question,
          ...(evalCase.locale ? { locale: evalCase.locale } : {}),
        }),
      );

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw new Error(`ask failed: ${response.status} ${response.statusText} ${detail}`.trim());
      }

      let answer = "";
      let refused = false;
      let refusalReason: string | undefined;
      let clarified = false;
      let options: string[] = [];
      const citedDocumentIds: string[] = [];
      // The one verification signal the wire carries: the names, when any
      // were found wanting. A clean answer sends nothing, which this target
      // cannot tell from an unchecked one, so it stays null then.
      let unsupportedTerms: string[] | null = null;

      for await (const event of readSse(response.body)) {
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
        } else if (event.type === "verification") {
          unsupportedTerms = event.unsupportedTerms;
        }
      }

      return {
        answer,
        refused,
        refusalReason,
        ...(clarified ? { clarified, options } : {}),
        citedDocumentIds,
        unsupportedTerms,
        // Null, not empty: the wire carries no retrieval detail at all, so this
        // target cannot tell "nothing was retrieved" from "I cannot see". Its
        // cases stay out of the retrieval average rather than scoring zero.
        retrieved: null,
        // The wire deliberately carries no token counts — what a site spends is
        // not the visitor's business — so a run over HTTP reports no cost.
        usage: { input: 0, output: 0, embedding: 0 },
        latencyMs: now() - started,
      };
    },
  };
}

async function* readSse(body: ReadableStream<Uint8Array>): AsyncIterable<AnswerEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const payload = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (payload) {
        try {
          yield JSON.parse(payload) as AnswerEvent;
        } catch {
          // A malformed frame is the server's problem to fix, not a reason to
          // abandon an answer that is otherwise arriving fine.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
