import { actionCalls, conversations, endUsers, messages } from "@deskbell/db";
import {
  INTENT_INFO,
  intentName,
  isIntent,
  isSignal,
  SIGNAL_INFO,
  signalName,
} from "@deskbell/shared";
import { Badge } from "@deskbell/ui/components/badge";
import { Button } from "@deskbell/ui/components/button";
import { cn } from "@deskbell/ui/lib/utils";
import { and, eq } from "drizzle-orm";
import {
  ArrowLeft,
  CircleHelp,
  CircleSlash,
  FileText,
  PenLine,
  Plug,
  Radar,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { FeedbackGlyph } from "@/components/feedback-glyph";
import { Markdown } from "@/components/markdown";
import { ThreadStatusBadge } from "@/components/thread-status-badge";
import { isAction, isWrittenAnswer, WRITTEN_ANSWER_LABEL } from "@/lib/citation-label";
import { parseCitations, uniqueByDocument } from "@/lib/conversation";
import { getDb } from "@/lib/db";
import { feedbackReasonSentence } from "@/lib/gap-task";
import { isWeakAnswer, readGapsConfig } from "@/lib/gaps-signal";
import { avatarClass, initialOf, relativeTime } from "@/lib/inbox";
import { formatLatency } from "@/lib/latency";
import { refusalLabel, retrievalSummary, unsupportedTitle } from "@/lib/refusal-label";
import { threadStatus, threadStatusDetail } from "@/lib/thread-status";

// The engine cites per retrieved chunk, so one document can appear repeatedly;
// a reader wants one pill per source. Rows whose jsonb no longer matches the
// wire schema render as no citations rather than failing the page.
// A tool result is cited like a page so the model can point at it, but the
// thread shows every call on its own row beneath the answer, so it is left
// out of the source pills.
function citationsOf(value: unknown[] | null) {
  return uniqueByDocument(parseCitations(value) ?? []).filter((c) => !isAction(c));
}

function AttrRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-1.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-xs break-all">{children}</dd>
    </div>
  );
}

const ACTION_STATUS_LABEL: Record<(typeof actionCalls.$inferSelect)["status"], string> = {
  running: "running",
  succeeded: "done",
  failed: "failed",
  pending_approval: "awaiting confirmation",
  approved: "confirmed",
  denied: "declined",
  expired: "expired",
};

function CallOutcome({
  status,
  latencyMs,
}: {
  status: (typeof actionCalls.$inferSelect)["status"];
  latencyMs: number | null;
}) {
  return (
    <span className="font-normal opacity-70">
      {ACTION_STATUS_LABEL[status]}
      {latencyMs != null ? ` · ${formatLatency(latencyMs)}` : ""}
    </span>
  );
}

const DATE: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * One thread: transcript and details (spec: conversations-page,
 * conversations-inbox-polish). Rendered by the thread route and, for the
 * newest thread, by the index route, so the two cannot drift.
 */
export async function ConversationThread({
  id,
  project,
}: {
  id: string;
  project: { orgId: string; id: string };
}) {
  const db = getDb();

  // Independent given the org-scoped id — parallel per async-parallel; the
  // transcript is discarded when the conversation check 404s.
  const [conversation, transcript] = await Promise.all([
    db.query.conversations.findFirst({
      where: and(
        eq(conversations.id, id),
        eq(conversations.orgId, project.orgId),
        eq(conversations.projectId, project.id),
      ),
    }),
    db.query.messages.findMany({
      where: and(eq(messages.conversationId, id), eq(messages.orgId, project.orgId)),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    }),
  ]);
  if (!conversation) notFound();

  // Every tool call this thread made, by the message it belongs to (spec:
  // mcp-actions): the operator sees what ran, on whose behalf, and how it ended.
  const calls = await db
    .select({
      id: actionCalls.id,
      messageId: actionCalls.messageId,
      tool: actionCalls.tool,
      title: actionCalls.title,
      status: actionCalls.status,
      serverId: actionCalls.serverId,
      summary: actionCalls.summary,
      details: actionCalls.details,
      latencyMs: actionCalls.latencyMs,
      error: actionCalls.error,
    })
    .from(actionCalls)
    .where(and(eq(actionCalls.conversationId, id), eq(actionCalls.orgId, project.orgId)))
    .orderBy(actionCalls.createdAt);
  const callsByMessage = new Map<string, typeof calls>();
  for (const call of calls) {
    if (!call.messageId) continue;
    callsByMessage.set(call.messageId, [...(callsByMessage.get(call.messageId) ?? []), call]);
  }

  // The verified visitor, when the project verifies identity (spec: end-user-identity).
  const endUser = conversation.endUserId
    ? await db.query.endUsers.findFirst({
        where: and(eq(endUsers.id, conversation.endUserId), eq(endUsers.orgId, project.orgId)),
        columns: { name: true, email: true, subject: true },
      })
    : null;
  const context = Object.entries(conversation.context ?? {});

  const firstQuestion = transcript.find((m) => m.role === "user")?.content;
  const gapsCfg = readGapsConfig();
  const weakOf = (m: { refused: boolean; clarified: boolean; retrievalTopScore: number | null }) =>
    !m.refused && isWeakAnswer(m, gapsCfg);
  const unsupportedOf = (m: { role: string; unsupportedTerms: string[] | null }) =>
    m.role === "assistant" && (m.unsupportedTerms?.length ?? 0) > 0;
  const counts = {
    answers: transcript.filter((m) => m.role === "assistant").length,
    refusals: transcript.filter((m) => m.refused).length,
    weak: transcript.filter((m) => m.role === "assistant" && weakOf(m)).length,
    unsupported: transcript.filter(unsupportedOf).length,
    turns: transcript.filter((m) => m.role === "user").length,
  };
  const status = threadStatus(counts);
  const uncertainDetail = threadStatusDetail(counts);
  const citedDocs = [
    ...new Map(
      transcript
        .flatMap((m) => citationsOf(m.citations))
        .map((citation) => [citation.documentId, citation]),
    ).values(),
  ];
  const lastMessage = transcript.at(-1);
  const visitorAvatar = avatarClass(conversation.sessionId);
  // One stable identity per visitor — not one initial per message.
  const visitorInitial = initialOf(firstQuestion ?? conversation.sessionId);

  return (
    <div className="flex h-full min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <Button variant="ghost" size="icon-sm" asChild className="md:hidden">
            <Link href="/conversations" aria-label="All conversations">
              <ArrowLeft />
            </Link>
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {conversation.title ?? firstQuestion ?? "Conversation"}
          </h2>
          <ThreadStatusBadge status={status} />
          <Badge variant="outline" className="text-muted-foreground">
            Widget
          </Badge>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-6 lg:px-6">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
            {transcript.map((message) => {
              const citations = citationsOf(message.citations);
              const messageCalls = callsByMessage.get(message.id) ?? [];
              const signal = retrievalSummary(message);
              const meta = [
                relativeTime(message.createdAt),
                message.latencyMs != null ? formatLatency(message.latencyMs) : null,
                message.model,
              ].filter(Boolean);
              return message.role === "user" ? (
                <div key={message.id} className="flex items-end gap-2">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
                      visitorAvatar,
                    )}
                  >
                    {visitorInitial}
                  </span>
                  <div className="flex min-w-0 max-w-[75%] flex-col gap-1">
                    <div className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-sm whitespace-pre-wrap">
                      {message.content}
                    </div>
                    <span className="flex flex-wrap items-center gap-1.5 pl-1 text-[11px] text-muted-foreground">
                      {relativeTime(message.createdAt)}
                      {/* Why they asked and how it went (spec: intent-and-signals), each with its rule. */}
                      {message.intent ? (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground"
                          title={
                            isIntent(message.intent)
                              ? INTENT_INFO[message.intent].description
                              : undefined
                          }
                        >
                          {intentName(message.intent)}
                        </Badge>
                      ) : null}
                      {(message.signals ?? []).map((signal) => (
                        <Badge
                          key={signal}
                          variant="outline"
                          title={isSignal(signal) ? SIGNAL_INFO[signal].description : undefined}
                        >
                          {signalName(signal)}
                        </Badge>
                      ))}
                    </span>
                  </div>
                </div>
              ) : (
                <div key={message.id} className="flex flex-col gap-1 pl-8">
                  <div className="flex min-w-0 max-w-[75%] flex-col gap-2 self-start rounded-2xl rounded-bl-md border bg-card px-3.5 py-2 text-sm">
                    {message.refused ? (
                      <Badge
                        variant="outline"
                        className="w-fit text-muted-foreground"
                        title={signal ?? undefined}
                      >
                        <CircleSlash className="fill-uncertain stroke-card" />
                        {refusalLabel(message.refusalReason)}
                      </Badge>
                    ) : message.clarified ? (
                      <Badge
                        variant="outline"
                        className="w-fit text-muted-foreground"
                        title="The docs answer this in more than one way; the visitor was asked which they meant"
                      >
                        <CircleHelp />
                        Asked to clarify
                      </Badge>
                    ) : unsupportedOf(message) ? (
                      <Badge
                        variant="outline"
                        className="w-fit text-muted-foreground"
                        title={unsupportedTitle(message.unsupportedTerms ?? [], signal)}
                      >
                        <TriangleAlert className="text-amber-500 dark:text-amber-400" />
                        Unsupported name{(message.unsupportedTerms?.length ?? 0) > 1 ? "s" : ""}
                      </Badge>
                    ) : weakOf(message) ? (
                      <Badge
                        variant="outline"
                        className="w-fit text-muted-foreground"
                        title={["The best retrieved match scored under the weak floor", signal]
                          .filter(Boolean)
                          .join(" — ")}
                      >
                        <TriangleAlert className="text-amber-500 dark:text-amber-400" />
                        Weak grounding
                      </Badge>
                    ) : null}
                    {message.content ? (
                      <div className="min-w-0 break-words">
                        <Markdown source={message.content} />
                      </div>
                    ) : (
                      <p className="text-muted-foreground italic">(no answer text)</p>
                    )}
                  </div>
                  {citations.length > 0 ? (
                    <div className="flex max-w-[75%] flex-wrap gap-1.5">
                      {citations.map((citation) => {
                        const written = isWrittenAnswer(citation);
                        const body = (
                          <>
                            {written ? <PenLine /> : <FileText />}
                            {citation.title}
                            {written ? (
                              <span className="font-normal opacity-70">{WRITTEN_ANSWER_LABEL}</span>
                            ) : null}
                          </>
                        );
                        return (
                          <Badge
                            key={citation.documentId}
                            variant="outline"
                            className="text-muted-foreground"
                            asChild={!!citation.url}
                          >
                            {citation.url ? (
                              <a href={citation.url} rel="noopener noreferrer" target="_blank">
                                {body}
                              </a>
                            ) : (
                              <span>{body}</span>
                            )}
                          </Badge>
                        );
                      })}
                    </div>
                  ) : null}
                  {messageCalls.length > 0 ? (
                    <div className="flex max-w-[75%] flex-wrap gap-1.5">
                      {messageCalls.map((call) => {
                        // What the visitor confirmed, then the audit's one line, then the error.
                        const tooltip =
                          [
                            call.details?.length
                              ? call.details.map((d) => `${d.label}: ${d.value}`).join(" · ")
                              : call.summary,
                            call.error,
                          ]
                            .filter(Boolean)
                            .join(" — ") || undefined;
                        // The title leads to the tool's row on its server's page (a
                        // call whose server was since removed keeps the name only);
                        // the outcome leads to the call's record in the actions log.
                        return (
                          <Badge
                            key={call.id}
                            variant="outline"
                            className="text-muted-foreground"
                            title={tooltip}
                          >
                            <Plug />
                            {call.serverId ? (
                              <Link
                                href={`/actions/${call.serverId}/${encodeURIComponent(call.tool)}`}
                                className="hover:underline"
                              >
                                {call.title}
                              </Link>
                            ) : (
                              call.title
                            )}
                            <Link
                              href={`/actions/log?call=${call.id}`}
                              className="hover:underline"
                              aria-label={`Call record: ${call.title}`}
                            >
                              <CallOutcome status={call.status} latencyMs={call.latencyMs} />
                            </Link>
                          </Badge>
                        );
                      })}
                    </div>
                  ) : null}
                  <span className="flex flex-wrap items-center gap-1.5 pl-1 text-[11px] text-muted-foreground tabular-nums">
                    Deskbell · {meta.join(" · ")}
                    <FeedbackGlyph feedback={message.feedback} className="size-3" />
                    {message.gapClusterId ? (
                      <Link
                        href={`/gaps?gap=${message.gapClusterId}`}
                        className="inline-flex items-center gap-1 hover:underline underline-offset-4"
                      >
                        <Radar className="size-3" />
                        Open in Gaps
                      </Link>
                    ) : null}
                  </span>
                  {message.feedback === "down" &&
                  (message.feedbackReason || message.feedbackComment) ? (
                    <span className="pl-1 text-[11px] text-destructive/80">
                      {[
                        message.feedbackReason
                          ? feedbackReasonSentence(message.feedbackReason)
                          : null,
                        message.feedbackComment ? `“${message.feedbackComment}”` : null,
                      ]
                        .filter(Boolean)
                        .join(" — ")}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <aside className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l xl:flex">
        <div className="border-b px-5 py-3">
          <h3 className="text-sm font-semibold">Details</h3>
        </div>
        <dl className="flex flex-col py-3">
          <AttrRow label="Id">
            <span className="font-mono">{conversation.id}</span>
          </AttrRow>
          {endUser ? (
            <AttrRow label="User">
              <span className="inline-flex flex-col items-end">
                <span>{endUser.name ?? endUser.email ?? endUser.subject}</span>
                {endUser.name && endUser.email ? (
                  <span className="text-muted-foreground">{endUser.email}</span>
                ) : null}
              </span>
            </AttrRow>
          ) : (
            <AttrRow label="Session">
              <span className="font-mono">{conversation.sessionId}</span>
            </AttrRow>
          )}
          {context.map(([key, value]) => (
            <AttrRow key={key} label={key}>
              {value.name ? (
                <span className="inline-flex flex-col items-end">
                  <span>{value.name}</span>
                  <span className="font-mono text-muted-foreground">{value.id}</span>
                </span>
              ) : (
                <span className="font-mono">{value.id}</span>
              )}
            </AttrRow>
          ))}
          <AttrRow label="Started">{conversation.createdAt.toLocaleString("en-US", DATE)}</AttrRow>
          <AttrRow label="Last activity">
            {lastMessage ? relativeTime(lastMessage.createdAt) : "—"}
          </AttrRow>
          <AttrRow label="Messages">{transcript.length}</AttrRow>
          <AttrRow label="Status">
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <ThreadStatusBadge status={status} />
              {uncertainDetail ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {uncertainDetail}
                </span>
              ) : null}
            </span>
          </AttrRow>
          {conversation.deletedAt ? (
            <AttrRow label="Deleted by visitor">
              {conversation.deletedAt.toLocaleString("en-US", DATE)}
            </AttrRow>
          ) : null}
        </dl>
        <div className="border-t px-5 py-3">
          <h4 className="text-xs font-semibold">Sources cited</h4>
        </div>
        <div className="flex flex-col gap-1 px-5 pb-5">
          {citedDocs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sources cited yet.</p>
          ) : (
            citedDocs.map((citation) => (
              <span key={citation.documentId} className="flex items-center gap-1.5 text-xs">
                {isWrittenAnswer(citation) ? (
                  <PenLine className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="size-3 shrink-0 text-muted-foreground" />
                )}
                {citation.url ? (
                  <a
                    href={citation.url}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="truncate hover:underline underline-offset-4"
                  >
                    {citation.title}
                  </a>
                ) : (
                  <span className="truncate">{citation.title}</span>
                )}
                {isWrittenAnswer(citation) ? (
                  <span className="shrink-0 text-muted-foreground">{WRITTEN_ANSWER_LABEL}</span>
                ) : null}
              </span>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
