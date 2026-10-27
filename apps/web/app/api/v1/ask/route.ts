import {
  type ActionReport,
  clarifyFromEnv,
  createEngine,
  createVectorStore,
  type EngineResume,
  lookupTerms,
  type RetrievalSummary,
  retrievalOptionsFromEnv,
  summarizeRetrieval,
  type TokenUsage,
  type Turn,
  verifyFromEnv,
} from "@deskbell/core";
import { chatModelId, createEngineModelDeps, reasoningVisible } from "@deskbell/core/models";
import { actionCalls, conversations, messages, readIgnoredTerms } from "@deskbell/db";
import {
  AskRequestSchema,
  actionSummary,
  type Citation,
  newId,
  type RefusalReason,
  splitActionToolName,
} from "@deskbell/shared";
import { and, eq, inArray } from "drizzle-orm";
import { after } from "next/server";

import { recordUsage, ZERO_USAGE } from "@/lib/abuse/budget";
import { actionConfig, identityIssuer } from "@/lib/actions/config";
import { type RequestTools, toolsForRequest } from "@/lib/actions/tools-for-request";
import { originFromHeaders } from "@/lib/base-url";
import {
  enqueueAssignGapCluster,
  enqueueClassifyQuestion,
  enqueueTitleConversation,
} from "@/lib/boss";
import { clarificationText, loadRecentTurns, titleFromQuestion } from "@/lib/conversation";
import { ownedBy } from "@/lib/conversation-access";
import { getDb } from "@/lib/db";
import { classifyAnswer, readGapsConfig } from "@/lib/gaps-signal";
import { bearerToken } from "@/lib/identity/resolve";
import { recordInstall } from "@/lib/installs";
import { type Heartbeat, startHeartbeat } from "@/lib/sse-heartbeat";
import { preflight } from "@/lib/widget-cors";
import { guardWidgetRequest } from "@/lib/widget-guard";

/**
 * Public widget endpoint — streams AnswerEvents as SSE.
 *
 * This is the endpoint that spends money, so it takes the full guard: origin
 * binding, bot filtering, per-IP and per-project rate limits, the project's
 * daily token budget, and a cap on concurrent streams (spec:
 * widget-abuse-protection). Every token the answer costs comes back through
 * `onUsage` and lands in token_usage once the stream closes.
 */

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = AskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request" },
      { status: 400, headers: { "access-control-allow-origin": "*" } },
    );
  }

  // An approval continues a paused turn (spec: mcp-actions): it needs the
  // conversation it paused in, and takes the whole guard like any ask — it
  // spends model tokens and runs a tool on the visitor's authority.
  const approval = parsed.data.approval;
  if (approval && !parsed.data.conversationId) {
    return Response.json(
      { error: "Invalid request" },
      { status: 400, headers: { "access-control-allow-origin": "*" } },
    );
  }

  const guard = await guardWidgetRequest(request, {
    projectKey: parsed.data.projectKey,
    kind: "ask",
  });
  if (!guard.ok) return guard.response;
  const { project, cors, slot, endUser } = guard;

  const db = getDb();

  // A question answered IS an install, whatever rendered it — the beacon only
  // sees clients that mount our widget, so a custom UI on @deskbell/sdk would
  // otherwise show as "pending" on the customer's own Deploy page. Deferred:
  // this must never buy a place in time-to-first-token. Unlike the beacon, the
  // origin here has already passed the allowlist, so /ask only ever reports
  // origins the project actually authorised.
  after(() => recordInstall(project, request.headers.get("origin")));

  // The slot is released by the stream's start() once the answer is persisted.
  // Until the streaming Response is actually handed back, every other exit —
  // an early return or a throw — must release it here, or the caller's
  // concurrency budget leaks until the process restarts.
  let streaming = false;
  try {
    const verify = verifyFromEnv();
    const ownDataReply = project.answering.ownDataReply;
    const engine = createEngine(
      {
        vectorStore: createVectorStore(db),
        ...createEngineModelDeps(),
        // The corpus lookup behind verification reads the chunk rows of
        // record (spec: answer-verification); the engine only sees names.
        lookupTerms: (orgId, projectId, terms) => lookupTerms(db, orgId, projectId, terms),
      },
      {
        retrieval: retrievalOptionsFromEnv(),
        clarify: clarifyFromEnv(),
        verify,
        // On only while the project has a reply to show (spec: own-data-fallback).
        ownDataFallback: ownDataReply !== undefined,
      },
    );
    // Names the project never wants flagged — the gaps page's list, reused.
    // Started here so it overlaps the conversation reads below; only paid
    // for when verification is on.
    const ignoredTermsRead = verify
      ? readIgnoredTerms(db, { orgId: project.orgId, projectId: project.id })
      : Promise.resolve([] as string[]);

    // A caller holds many conversations (spec: widget-conversation-history):
    // the widget names the thread to continue, or omits it to start a new one.
    // Ownership (spec: end-user-identity) is the authorization for continuing.
    let conversation: typeof conversations.$inferSelect | undefined;
    // Turns preceding this one. Read BEFORE the visitor's message is inserted
    // below, or the question would arrive as its own context.
    let history: Turn[] = [];
    // The call being answered, when this ask carries an approval.
    let pending: typeof actionCalls.$inferSelect | undefined;
    if (parsed.data.conversationId) {
      // Independent given the org-scoped id, so they overlap instead of queueing
      // on the paid path; the turns are discarded if ownership fails.
      const [found, turns, call] = await Promise.all([
        db.query.conversations.findFirst({
          where: and(
            eq(conversations.id, parsed.data.conversationId),
            eq(conversations.orgId, project.orgId),
            eq(conversations.projectId, project.id),
            ownedBy({ sessionId: parsed.data.sessionId, endUser }),
          ),
        }),
        approval
          ? Promise.resolve([] as Turn[])
          : loadRecentTurns(db, {
              orgId: project.orgId,
              conversationId: parsed.data.conversationId,
            }),
        approval
          ? db.query.actionCalls.findFirst({
              where: and(
                eq(actionCalls.id, approval.callId),
                eq(actionCalls.orgId, project.orgId),
                eq(actionCalls.conversationId, parsed.data.conversationId),
                eq(actionCalls.status, "pending_approval"),
              ),
            })
          : Promise.resolve(undefined),
      ]);
      conversation = found;
      if (!conversation) {
        return Response.json({ error: "Unknown conversation" }, { status: 404, headers: cors });
      }
      history = turns;
      if (approval) {
        // Ownership of the conversation is ownership of its pending calls; a
        // foreign, answered or expired id is simply unknown.
        const expired = call?.expiresAt ? call.expiresAt.getTime() < Date.now() : false;
        if (!call?.approvalId || !call.resumeMessages || expired) {
          return Response.json({ error: "Unknown request" }, { status: 404, headers: cors });
        }
        pending = call;
        // The row written when the turn paused is replayed from the stored
        // step, so it must not also arrive as history.
        history = await loadRecentTurns(db, {
          orgId: project.orgId,
          conversationId: parsed.data.conversationId,
          excludeMessageId: call.messageId ?? undefined,
        });
      }
    } else {
      [conversation] = await db
        .insert(conversations)
        .values({
          id: newId("conv"),
          orgId: project.orgId,
          projectId: project.id,
          sessionId: parsed.data.sessionId,
          endUserId: endUser?.id ?? null,
          // Context and title are creation-time facts (spec:
          // conversation-context-and-titles): the page that started the
          // thread names where it started, and the first question names it.
          context: parsed.data.context ?? null,
          title: titleFromQuestion(parsed.data.message),
        })
        .returning();
      // A better title costs a model call, so it is opt-in and off the
      // visitor's path: the queue failing is logged, never surfaced.
      if (conversation && process.env.DESKBELL_THREAD_TITLES?.trim() === "model") {
        enqueueTitleConversation({
          orgId: project.orgId,
          projectId: project.id,
          conversationId: conversation.id,
        }).catch((error) => console.error("[ask] failed to enqueue titling:", error));
      }
    }
    if (!conversation) {
      return Response.json({ error: "Conversation unavailable" }, { status: 500, headers: cors });
    }
    const conversationId = conversation.id;

    if (pending) {
      // Answered now, before anything runs: a second answer to the same
      // request finds no pending row and gets a 404.
      await db
        .update(actionCalls)
        .set({
          status: approval?.approved ? "approved" : "denied",
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(actionCalls.id, pending.id));
    } else {
      const questionId = newId("msg");
      await db.insert(messages).values({
        id: questionId,
        orgId: project.orgId,
        conversationId,
        role: "user",
        content: parsed.data.message,
      });
      // A question gets its topic, intent and signals off the visitor's path
      // (spec: question-topics, intent-and-signals): while the project's
      // labelling switch is on, and a queue failure is logged — the hourly
      // catch-up labels what this missed.
      if (project.classifyQuestions) {
        enqueueClassifyQuestion({
          orgId: project.orgId,
          projectId: project.id,
          messageId: questionId,
        }).catch((error) => console.error("[ask] failed to enqueue question labelling:", error));
      }
    }

    // The tools this visitor may use (spec: mcp-actions). Never on the way
    // of an answer: a server that cannot be set up is logged and left out.
    let requestTools: RequestTools | null = null;
    try {
      requestTools = await toolsForRequest({
        db,
        project,
        endUser,
        // The token the guard just verified, for servers that take the
        // visitor's own (spec: visitor-token-actions). Only beside a verified
        // visitor: an unverified header is never forwarded anywhere.
        visitorToken: endUser ? bearerToken(request.headers.get("authorization")) : null,
        conversationId,
        issuer: identityIssuer(originFromHeaders(request.headers)),
      });
    } catch (error) {
      console.error("[ask] failed to prepare actions, answering without them:", error);
    }
    const resume: EngineResume | undefined =
      pending?.approvalId && pending.resumeMessages
        ? {
            messages: pending.resumeMessages,
            approval: {
              approvalId: pending.approvalId,
              approved: approval?.approved === true,
              ...(approval?.approved ? {} : { reason: "The visitor declined" }),
            },
          }
        : undefined;

    const encoder = new TextEncoder();
    let heartbeat: Heartbeat | null = null;
    const stream = new ReadableStream({
      async start(controller) {
        // The client can leave at any moment — the widget aborts the request
        // when the panel closes or a new question is sent — and from then on
        // every enqueue throws. A throw from the heartbeat timer has no caller
        // to land in and takes the whole process down, so every write goes
        // through one guard that turns the first failure into silence and
        // stops the timer. The answer is still persisted below: it was
        // generated and paid for, whether or not anyone is left to read it.
        let open = true;
        const write = (chunk: string) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            open = false;
            heartbeat?.stop();
          }
        };
        // Headers are not flushed until the first byte, and the first event
        // is the first token — everything before it is one silence to the
        // client. The heartbeat opens the stream at once and keeps a proxy
        // from closing it during a long answer (spec: sse-heartbeat).
        const hb = startHeartbeat(write);
        heartbeat = hb;
        const send = (event: unknown) => {
          write(`data: ${JSON.stringify(event)}\n\n`);
          hb.touch();
        };

        // Accumulated for persistence — refusals included: unanswered questions
        // are the docs-gap analytics raw material (D8).
        let answerText = "";
        let citations: Citation[] | null = null;
        let refused = false;
        // The engine asked which reading the visitor meant (spec:
        // clarifying-questions). Stored as an assistant turn, never an answer.
        let clarified = false;
        // What retrieval returned, kept for the refusal path. A refusal has no
        // "sources the answer used", but the chunks it declined to answer from
        // are exactly the evidence needed to work out why — and refusals are
        // the raw material for docs-gap analytics (D8).
        let retrieved: Citation[] = [];
        // What the engine knew when it answered (spec: answer-signal): the
        // evidence in three numbers, why it refused, whether the model named
        // its sources. Persisted so an answer written from weak evidence is
        // visible without waiting for a visitor to complain.
        // One object, not three lets: the callbacks below assign from inside
        // closures, which narrows a bare `let` to `never` at the read site.
        const signal: {
          retrieval: RetrievalSummary | null;
          refusalReason: RefusalReason | null;
          sourcesNamed: boolean | null;
          /** Null until a check ran (spec: answer-verification); empty means clean. */
          unsupportedTerms: string[] | null;
        } = { retrieval: null, refusalReason: null, sourcesNamed: null, unsupportedTerms: null };
        // The engine reports each cost as it becomes known; we sum and write once.
        const usage: TokenUsage = { ...ZERO_USAGE };

        // Every tool call becomes an audit row (spec: mcp-actions; D7). The
        // engine names calls by the model's id; the widget and the resume
        // path name them by the row, so ids are rewritten on the way out.
        // Writes are queued so their order is the order things happened.
        const rowByCall = new Map<string, string>();
        if (pending?.toolCallId) rowByCall.set(pending.toolCallId, pending.id);
        const newRows: string[] = [];
        let paused = false;
        let audit: Promise<unknown> = Promise.resolve();
        const record = (work: () => Promise<unknown>) => {
          audit = audit.then(work).catch((error) => {
            console.error("[ask] failed to record an action:", error);
          });
        };
        const rowId = (callId: string) => {
          let id = rowByCall.get(callId);
          if (!id) {
            id = newId("act");
            rowByCall.set(callId, id);
            newRows.push(id);
          }
          return id;
        };
        const toolOf = (name: string) => splitActionToolName(name)?.tool ?? name;
        const outputFor = (output: unknown) => {
          const text = JSON.stringify(output ?? null) ?? "null";
          return text.length > 16_000
            ? { output: text.slice(0, 16_000), truncated: true }
            : { output, truncated: false };
        };
        const onAction = (report: ActionReport) => {
          switch (report.type) {
            case "call": {
              const id = rowId(report.callId);
              record(() =>
                db.insert(actionCalls).values({
                  id,
                  orgId: project.orgId,
                  projectId: project.id,
                  conversationId,
                  serverId: requestTools?.serverOf(report.tool)?.id ?? null,
                  tool: toolOf(report.tool),
                  title: report.title,
                  input: (report.input ?? {}) as Record<string, unknown>,
                  status: "running",
                  toolCallId: report.callId,
                  endUserId: endUser?.id ?? null,
                }),
              );
              break;
            }
            case "result": {
              const id = rowId(report.callId);
              const stored = outputFor(report.output);
              record(() =>
                db
                  .update(actionCalls)
                  .set({
                    status: report.error ? "failed" : "succeeded",
                    output: stored.output,
                    outputTruncated: stored.truncated,
                    error: report.error ?? null,
                    latencyMs: report.latencyMs,
                    updatedAt: new Date(),
                  })
                  .where(eq(actionCalls.id, id)),
              );
              break;
            }
            case "approval": {
              const id = rowId(report.callId);
              paused = true;
              record(() =>
                db.insert(actionCalls).values({
                  id,
                  orgId: project.orgId,
                  projectId: project.id,
                  conversationId,
                  serverId: requestTools?.serverOf(report.tool)?.id ?? null,
                  tool: toolOf(report.tool),
                  title: report.title,
                  input: (report.input ?? {}) as Record<string, unknown>,
                  status: "pending_approval",
                  summary: actionSummary(report.title, report.input),
                  details: report.details,
                  toolCallId: report.callId,
                  approvalId: report.approvalId,
                  approvalSignature: report.signature ?? null,
                  expiresAt: new Date(Date.now() + actionConfig().approvalTtlMs),
                  endUserId: endUser?.id ?? null,
                }),
              );
              break;
            }
            case "paused": {
              const ids = [...rowByCall.values()];
              record(() =>
                db
                  .update(actionCalls)
                  .set({ resumeMessages: report.messages, updatedAt: new Date() })
                  .where(
                    and(inArray(actionCalls.id, ids), eq(actionCalls.status, "pending_approval")),
                  ),
              );
              break;
            }
          }
        };

        const started = performance.now();
        // A deployment decision, never the request's (spec: activity-disclosure).
        const showReasoning = reasoningVisible();
        try {
          const ignoredTerms = await ignoredTermsRead;
          for await (const raw of engine.ask({
            orgId: project.orgId,
            projectId: project.id,
            conversationId,
            message: parsed.data.message,
            history,
            locale: parsed.data.locale,
            ignoredTerms,
            // The project's voice (spec: answer-style); a row field, so a
            // save on the settings page reaches the next answer.
            answerStyle: project.answerStyle,
            ...(requestTools && requestTools.tools.length > 0 ? { tools: requestTools.tools } : {}),
            ...(resume ? { resume } : {}),
            onAction,
            onRetrieval: (chunks) => {
              signal.retrieval = summarizeRetrieval(chunks);
              retrieved = chunks.map((chunk) => ({
                documentId: chunk.documentId,
                url: chunk.url,
                title: chunk.title,
                snippet: chunk.content.slice(0, 200),
                kind: chunk.sourceType,
              }));
            },
            onUsage: (u) => {
              usage.input += u.input;
              usage.output += u.output;
              usage.embedding += u.embedding;
            },
            onSources: (s) => {
              signal.sourcesNamed = s.named;
            },
            onVerification: (r) => {
              signal.unsupportedTerms = r.unsupported;
            },
          })) {
            let event = raw;
            if (event.type === "done") continue; // replaced by our own below, with a real messageId
            if (event.type === "reasoning" && !showReasoning) continue;
            if (event.type === "token") answerText += event.value;
            if (event.type === "citations") {
              citations = event.citations.map((c) =>
                c.documentId.startsWith("action:")
                  ? { ...c, documentId: `action:${rowId(c.documentId.slice("action:".length))}` }
                  : c,
              );
              event = { type: "citations", citations };
            }
            if (event.type === "refusal") {
              refused = true;
              signal.refusalReason = event.reason;
              // A refusal persists no answer text, even when the model wrote
              // a sentence before refusing: the widget replaced that sentence
              // with the refusal copy, and the replay must show the same.
              answerText = "";
              if (event.reason === "no_access" && ownDataReply !== undefined) {
                // The one refusal that persists text (spec: own-data-fallback):
                // the project's reply is what the visitor read, what the
                // replay shows, and what the model reads back as history so
                // it does not say it twice.
                answerText = ownDataReply;
                event = { type: "refusal", reason: event.reason, text: ownDataReply };
              }
            }
            if (event.type === "clarify") {
              clarified = true;
              // The stored text is what the replay shows and what the model
              // reads back as history when the visitor answers.
              answerText = clarificationText(event);
            }
            if (event.type === "action") event = { ...event, id: rowId(event.id) };
            if (event.type === "confirm") {
              event = {
                ...event,
                id: rowId(event.id),
                expiresAt: new Date(Date.now() + actionConfig().approvalTtlMs).toISOString(),
              };
            }
            send(event);
          }
        } catch (error) {
          console.error("[ask] engine error:", error);
          refused = true;
          signal.refusalReason = "guardrail";
          send({ type: "refusal", reason: "guardrail" });
        } finally {
          await requestTools?.close();
        }
        await audit;
        const latencyMs = Math.round(performance.now() - started);

        let messageId = "";
        try {
          const id = newId("msg");
          await db.insert(messages).values({
            id,
            orgId: project.orgId,
            conversationId,
            role: "assistant",
            content: answerText,
            // A refusal keeps the retrieval evidence. Storing null discarded it
            // on exactly the answers most worth debugging: "refused with eight
            // poor chunks" and "refused with none" are different problems.
            citations: refused ? retrieved : citations,
            refused,
            clarified,
            refusalReason: signal.refusalReason,
            retrievalHits: signal.retrieval?.hits ?? null,
            retrievalTopScore: signal.retrieval?.topScore ?? null,
            retrievalMeanScore: signal.retrieval?.meanScore ?? null,
            // Null on a refusal or a clarification: no answer to name sources for.
            sourcesNamed: refused || clarified ? null : signal.sourcesNamed,
            // Null when unchecked, for the same reasons and when the lookup failed.
            unsupportedTerms: refused || clarified ? null : signal.unsupportedTerms,
            latencyMs,
            model: chatModelId(),
          });
          // Only after the row exists. Assigning it before meant a failed insert
          // still shipped a done event naming a message that was never written,
          // and feedback against that id fails for a reason nobody can see.
          messageId = id;
          // The calls this turn made belong to this message; a call answered
          // now keeps the message it paused under, where its card is.
          if (newRows.length > 0) {
            await db
              .update(actionCalls)
              .set({ messageId: id, updatedAt: new Date() })
              .where(inArray(actionCalls.id, newRows));
          }

          // A gap row goes to the clustering queue (spec: gap-clusters). Never
          // on the visitor's path to an answer: a queue failure is logged and
          // the hourly catch-up assigns what this missed.
          const signalRow = {
            refused,
            clarified,
            feedback: null,
            refusalReason: signal.refusalReason,
            sourcesNamed: signal.sourcesNamed,
            retrievalTopScore: signal.retrieval?.topScore ?? null,
            unsupportedTerms: signal.unsupportedTerms,
          };
          if (!paused && classifyAnswer(signalRow, readGapsConfig()).isGap) {
            try {
              await enqueueAssignGapCluster({
                orgId: project.orgId,
                projectId: project.id,
                messageId: id,
              });
            } catch (error) {
              console.error("[ask] failed to enqueue gap clustering:", error);
            }
          }
        } catch (error) {
          console.error("[ask] failed to persist assistant message:", error);
        }

        // Charging the budget must never fail an answer the visitor already has
        // — but a silent failure would make the budget unenforceable, so it is
        // loud in the log.
        try {
          await recordUsage(db, { orgId: project.orgId, projectId: project.id, usage });
        } catch (error) {
          console.error("[ask] failed to record token usage:", error);
        }

        slot?.release();
        // Before close, not after: a ping enqueued on a closed controller throws.
        hb.stop();
        send({ type: "done", conversationId, messageId });
        if (open) controller.close();
      },
      cancel() {
        // The client went away. Nothing else stops the timer on this path.
        heartbeat?.stop();
      },
    });

    const response = new Response(stream, {
      headers: {
        ...cors,
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
    streaming = true;
    return response;
  } finally {
    if (!streaming) slot?.release();
  }
}
