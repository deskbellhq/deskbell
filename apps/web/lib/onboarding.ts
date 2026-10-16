import {
  actionServers,
  conversations,
  documents,
  messages,
  sources,
  widgetInstalls,
} from "@deskbell/db";
import { CORRECTIONS_SOURCE_TYPE } from "@deskbell/shared";
import { and, asc, count, desc, eq, lte, ne, sql } from "drizzle-orm";

import { getSelfHosts, hostOfOrigin } from "./base-url";
import { getDb } from "./db";

/**
 * First-run checklist state (spec: single-tag-embed-deploy-onboarding).
 *
 * Everything is derived from live rows — sources, messages, widget_installs —
 * so the checklist can never disagree with reality; the only stored bit is
 * projects.onboardingDismissedAt. The activation event is `widgetLive`: the
 * widget pinged from an origin that is not this deployment's own (the
 * dashboard dogfoods the widget, so its origin must not count).
 */
export interface OnboardingStatus {
  sourceAdded: boolean;
  sourceReady: boolean;
  sourceSyncing: boolean;
  /** An assistant answer exists — refusals count: an honest refusal is the product working. */
  asked: boolean;
  originAllowed: boolean;
  widgetLive: boolean;
  firstForeignOrigin: string | null;
  complete: boolean;
  dismissed: boolean;
}

interface ProjectRow {
  id: string;
  orgId: string;
  allowedOrigins: string[];
  onboardingDismissedAt: Date | null;
}

/**
 * Has this project ever produced an assistant answer? Refusals count — an
 * honest refusal is the product working. Shared with the Deploy page, which
 * uses it to tell "nobody has installed anything" apart from "something is
 * answering questions from a client we cannot see".
 */
export async function hasAnsweredQuestion(project: {
  id: string;
  orgId: string;
}): Promise<boolean> {
  const rows = await getDb()
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.orgId, project.orgId),
        eq(conversations.projectId, project.id),
        eq(messages.role, "assistant"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function getOnboardingStatus(project: ProjectRow): Promise<OnboardingStatus> {
  const db = getDb();
  // Hosts, not origins: we cannot observe the scheme the browser used, so an
  // origin comparison silently stops matching behind a TLS-terminating proxy —
  // and the dashboard's own dogfood install then reads as a foreign one, which
  // would mark "put it on your site" complete and name the operator's own
  // dashboard as the site it went live on. selfHosts() is the same derivation
  // the abuse guard exempts on, so the two cannot disagree about what is us.
  const appHosts = new Set(await getSelfHosts());

  const [sourceRows, asked, installRows] = await Promise.all([
    // Crawled sources only: the guide's first step is the operator's docs,
    // and an answer written by hand neither shows a URL nor stands in for
    // them (spec: corrections-source).
    db
      .select({ status: sources.status })
      .from(sources)
      .where(
        and(
          eq(sources.orgId, project.orgId),
          eq(sources.projectId, project.id),
          ne(sources.type, CORRECTIONS_SOURCE_TYPE),
        ),
      ),
    hasAnsweredQuestion(project),
    db
      .select({ origin: widgetInstalls.origin })
      .from(widgetInstalls)
      .where(and(eq(widgetInstalls.orgId, project.orgId), eq(widgetInstalls.projectId, project.id)))
      .orderBy(asc(widgetInstalls.firstSeenAt)),
  ]);

  const sourceReady = sourceRows.some((s) => s.status === "ready");
  const foreign = installRows.find((i) => {
    const host = hostOfOrigin(i.origin);
    return host !== null && !appHosts.has(host);
  });

  return {
    sourceAdded: sourceRows.length > 0,
    sourceReady,
    sourceSyncing: sourceRows.some((s) => s.status === "pending" || s.status === "syncing"),
    asked,
    // The deployment's own origin does not count here either: allowing it by
    // hand starts nothing, and "listening" for its beacon would never end.
    originAllowed: project.allowedOrigins.some((o) => {
      const host = hostOfOrigin(o);
      return host !== null && !appHosts.has(host);
    }),
    widgetLive: foreign !== undefined,
    firstForeignOrigin: foreign?.origin ?? null,
    complete: sourceReady && asked && foreign !== undefined,
    dismissed: project.onboardingDismissedAt !== null,
  };
}

/**
 * What the getting-started page shows inside the steps (spec:
 * overview-getting-started): each source with how many pages it has stored
 * so far, and the first answer the project ever gave, as proof that step
 * two happened. Separate from the status on purpose — the status is cheap
 * and read on every Overview load; this is read only while the guide shows.
 */
export interface OnboardingDetails {
  sources: { id: string; url: string | null; status: string; docCount: number }[];
  firstAnswer: { question: string | null; citations: number; refused: boolean } | null;
  /** MCP servers attached, for the optional "connect an action" step. */
  actionServers: number;
}

export async function getOnboardingDetails(project: {
  id: string;
  orgId: string;
}): Promise<OnboardingDetails> {
  const db = getDb();
  const scope = and(
    eq(conversations.orgId, project.orgId),
    eq(conversations.projectId, project.id),
  );
  const servers = db.$count(
    actionServers,
    and(eq(actionServers.orgId, project.orgId), eq(actionServers.projectId, project.id)),
  );
  const [sourceRows, [first]] = await Promise.all([
    db
      .select({
        id: sources.id,
        status: sources.status,
        config: sources.config,
        docCount: count(documents.id),
      })
      .from(sources)
      .leftJoin(documents, eq(documents.sourceId, sources.id))
      .where(
        and(
          eq(sources.orgId, project.orgId),
          eq(sources.projectId, project.id),
          ne(sources.type, CORRECTIONS_SOURCE_TYPE),
        ),
      )
      .groupBy(sources.id)
      .orderBy(asc(sources.createdAt)),
    db
      .select({
        conversationId: messages.conversationId,
        createdAt: messages.createdAt,
        refused: messages.refused,
        citations: sql`coalesce(jsonb_array_length(${messages.citations}), 0)`.mapWith(Number),
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(scope, eq(messages.role, "assistant")))
      .orderBy(asc(messages.createdAt))
      .limit(1),
  ]);

  // The question is the closest user turn before the answer. A second round
  // trip rather than a correlated subquery: this runs only on the guide, and
  // the correlated form has already bitten once in this repository.
  const [asked] = first
    ? await db
        .select({ content: messages.content })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, first.conversationId),
            eq(messages.role, "user"),
            lte(messages.createdAt, first.createdAt),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(1)
    : [];

  return {
    sources: sourceRows.map((row) => ({
      id: row.id,
      url: typeof row.config.url === "string" ? row.config.url : null,
      status: row.status,
      docCount: row.docCount,
    })),
    firstAnswer: first
      ? { question: asked?.content ?? null, citations: first.citations, refused: first.refused }
      : null,
    actionServers: await servers,
  };
}
