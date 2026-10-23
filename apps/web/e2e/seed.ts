import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  actionCalls,
  actionServers,
  conversations,
  createDb,
  documents,
  endUsers,
  gapClusters,
  messages,
  organizations,
  projects,
  type StoredGapAnalysis,
  sources,
} from "@deskbell/db";
import { CORRECTIONS_SOURCE_TYPE, GAP_ANALYSIS_BUDGET_ERROR } from "@deskbell/shared";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { exportJWK, generateKeyPair } from "jose";

import { contentHash, correctionContent } from "../lib/corrections";
import { adminDatabaseUrl, e2eDatabaseUrl } from "./database";

/**
 * A fresh, deterministic database for the browser suite (spec:
 * dashboard-browser-tests). Creates `<name>_e2e` if missing, migrates it,
 * clears accounts so the first-user bootstrap applies, seeds the default
 * workspace, and inserts gap rows whose dates are offsets from now — so
 * "last 7 days" means the same thing on every run.
 *
 * What the rows are, and why (the tests assert exactly this):
 *   A  "How do I export a feed?"        2 phrasings, refused twice, 12–13 days ago, analysed
 *   B  "Where is the API key?"          answered, marked down, today; cites a page and H's
 *                                       written answer (spec: answer-citation-labels)
 *   C  "What does a rule box cost?"     answered from a weak match, 3 days ago
 *   D  "How is billing calculated?"     refused 40 days ago, resolved 35 days ago (outside 30d)
 *   E  "Does it work offline?"          refused before the signal columns existed, 20 days ago
 *   F  "How do I rotate a key?"         refused 100 days ago, analysis requested just now (pending)
 *   G  "Can I self-host on ARM?"        refused 45 days ago, analysis refused for budget
 *   H  "How do I cancel my plan?"       refused 8 days ago, resolved 5 days ago by a written
 *                                       answer, so it shows as Answered on the resolved views
 *                                       of 30 days and up, and the 7-day resolved view is empty
 *                                       (spec: corrections-source, gaps-status-filter)
 * The page shows open clusters by default (spec: gaps-status-filter), so the
 * resolved D and H are on the Resolved and All views only.
 * Default order (recent): B, C, A, E; the status control reads Open 4 · Resolved 1 · All 5.
 * Most asked: A, B, C, E.  Last 7 days: B, C.
 * All time: B, C, A, E, G, F; with every status B, C, A, E, G, F, H, D.
 * Last 90 days adds G, and the resolved D on the resolved views.
 *
 * H's answer lives under the project's corrections source, the only source in
 * the seed; the onboarding guide ignores that type, so the overview still
 * reads as "no source".
 *
 * The widget suite (spec: widget-browser-tests) adds: identity with an inline key set whose private half is
 * written to `.auth/identity-key.json` so specs can sign tokens; two signed-in
 * visitors, one with two threads (one carrying a site context) and one with a
 * thread the staff preview reads.
 */

const ORG = "org_dev";
const PROJECT = "proj_dev";
const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));
const IDENTITY_KEY_FILE = fileURLToPath(new URL("./.auth/identity-key.json", import.meta.url));

export const WIDGET = {
  hostOrigin: "http://127.0.0.1:8765",
  projectKey: "pk_dev_default",
  issuer: "https://e2e.issuer.test",
  audience: "widget-e2e",
  staffClaim: { path: "roles", value: "support" },
  visitors: {
    one: { id: "eu_e2e_v1", subject: "visitor-1", name: "Visitor One", email: "one@e2e.test" },
    two: { id: "eu_e2e_v2", subject: "visitor-2", name: "Visitor Two", email: "two@e2e.test" },
  },
  threads: {
    v1Site: { id: "conv_e2e_v1a", title: "Export settings" },
    v1Free: { id: "conv_e2e_v1b", title: "Billing question" },
    v2: { id: "conv_e2e_v2", title: "Rule boxes" },
  },
} as const;

/**
 * The usage suite (spec: usage-page, question-topics): anonymous threads
 * carrying a `user_type` and an `account` context, their questions labelled
 * with the project's two topics. Session 1 asks on two different days, so it
 * is the one returning visitor among customers. Dates are offsets from now,
 * all inside the last seven days and all older than B's thread, which the
 * Conversations page expects to find newest.
 */
export const USAGE = {
  topics: [
    { key: "billing", name: "Billing", description: "invoices, plans and payment" },
    { key: "exports", name: "Exports", description: "feeds, files and formats" },
  ],
  accounts: {
    acme: { id: "acc_acme", name: "Acme" },
    globex: { id: "acc_globex", name: "Globex" },
    initech: { id: "acc_initech", name: "Initech" },
  },
  threads: [
    {
      id: "conv_e2e_u1",
      session: "e2e-usage-1",
      userType: "customer",
      account: "acme",
      day: 1,
      questions: [
        ["How are invoices issued?", "billing"],
        ["Can I pay by card?", "billing"],
      ],
    },
    {
      id: "conv_e2e_u2",
      session: "e2e-usage-1",
      userType: "customer",
      account: "acme",
      day: 3,
      questions: [["Can I export to CSV?", "exports"]],
    },
    {
      id: "conv_e2e_u3",
      session: "e2e-usage-2",
      userType: "customer",
      account: "globex",
      day: 2,
      questions: [
        ["How do I schedule an export?", "exports"],
        ["Where is my invoice?", "billing"],
      ],
    },
    {
      id: "conv_e2e_u4",
      session: "e2e-usage-3",
      userType: "internal",
      account: "initech",
      day: 4,
      questions: [
        ["What is the weather like?", "other"],
        ["Is this labelled yet?", null],
      ],
    },
  ],
} as const;

export const SEED = {
  clusters: {
    A: { id: "gap_e2e_a", label: "How do I export a feed?" },
    B: { id: "gap_e2e_b", label: "Where is the API key?" },
    C: { id: "gap_e2e_c", label: "What does a rule box cost?" },
    D: { id: "gap_e2e_d", label: "How is billing calculated?" },
    E: { id: "gap_e2e_e", label: "Does it work offline?" },
    F: { id: "gap_e2e_f", label: "How do I rotate a key?" },
    G: { id: "gap_e2e_g", label: "Can I self-host on ARM?" },
    H: { id: "gap_e2e_h", label: "How do I cancel my plan?" },
  },
  corrections: {
    sourceId: "src_e2e_corrections",
    H: {
      documentId: "doc_e2e_corr_h",
      answer:
        "Open Billing, choose Cancel plan, and confirm.\nAccess continues to the end of the period.",
    },
  },
  actions: {
    server: { id: "srv_e2e_seeded", name: "Seeded Shop" },
    calls: {
      done: "act_e2e_done",
      failed: "act_e2e_failed",
      awaiting: "act_e2e_awaiting",
      declined: "act_e2e_declined",
    },
  },
  analysis: {
    title: "Exporting feeds",
    finding: "Visitors wanted to export a feed; the retrieved pages cover imports only.",
    recommendation: "Add an Exports page with the button's location and the file format.",
    suggestedFacts: ["Exports are CSV files", "The export button is on the feed page"],
  },
} as const;

const daysAgo = (days: number, now: Date) => new Date(now.getTime() - days * 86_400_000);

async function ensureDatabase(): Promise<void> {
  const target = new URL(e2eDatabaseUrl());
  const name = target.pathname.replace(/^\//, "");
  const admin = createDb(adminDatabaseUrl());
  try {
    const { rows } = await admin.execute(sql`select 1 from pg_database where datname = ${name}`);
    if (rows.length === 0) await admin.execute(sql.raw(`create database "${name}"`));
  } finally {
    await admin.$client.end();
  }
}

export async function seedBrowserSuite(now: Date = new Date()): Promise<void> {
  await ensureDatabase();
  const db = createDb(e2eDatabaseUrl());
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS });

    // Everything a run may have left behind, accounts included: the first
    // registration of a run must be the instance's first user.
    const tables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const present = new Set(tables.rows.map((r) => r.table_name));
    const wipe = [
      "messages",
      "conversations",
      "gap_clusters",
      "token_usage",
      "rate_limits",
      "widget_installs",
      "end_users",
      "chunks",
      "documents",
      "sources",
      "sessions",
      "accounts",
      "verifications",
      "invitations",
      "members",
      "users",
      "projects",
      "organizations",
    ].filter((t) => present.has(t));
    await db.execute(sql.raw(`truncate ${wipe.map((t) => `"${t}"`).join(", ")} cascade`));

    // A fresh signing key per seed; the public half goes into the project, the
    // private half beside the saved session so specs can mint tokens.
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const publicJwk = { ...(await exportJWK(publicKey)), kid: "e2e", alg: "ES256", use: "sig" };
    mkdirSync(fileURLToPath(new URL("./.auth/", import.meta.url)), { recursive: true });
    writeFileSync(IDENTITY_KEY_FILE, JSON.stringify(await exportJWK(privateKey)));

    await db.insert(organizations).values({ id: ORG, name: "Deskbell Dev", slug: "deskbell-dev" });
    await db.insert(projects).values({
      id: PROJECT,
      orgId: ORG,
      name: "Default project",
      publicKey: WIDGET.projectKey,
      // Empty: the overview guide's first-run state depends on it. The widget
      // specs add their host origin themselves (see widget/host.ts).
      allowedOrigins: [],
      appearance: {},
      identity: {
        issuer: WIDGET.issuer,
        audience: WIDGET.audience,
        required: false,
        jwks: { keys: [publicJwk] },
        staffClaim: { ...WIDGET.staffClaim },
      },
      topics: [...USAGE.topics],
    });

    const { one, two } = WIDGET.visitors;
    await db.insert(endUsers).values(
      [one, two].map((v) => ({
        id: v.id,
        orgId: ORG,
        projectId: PROJECT,
        issuer: WIDGET.issuer,
        subject: v.subject,
        name: v.name,
        email: v.email,
      })),
    );
    const owned = [
      {
        ...WIDGET.threads.v1Site,
        owner: one.id,
        context: { site: { id: "site-1", name: "Shop" } },
        at: daysAgo(1, now),
      },
      { ...WIDGET.threads.v1Free, owner: one.id, context: null, at: daysAgo(2, now) },
      { ...WIDGET.threads.v2, owner: two.id, context: null, at: daysAgo(1, now) },
    ];
    for (const t of owned) {
      await db.insert(conversations).values({
        id: t.id,
        orgId: ORG,
        projectId: PROJECT,
        sessionId: `e2e-${t.owner}`,
        endUserId: t.owner,
        title: t.title,
        context: t.context,
        createdAt: t.at,
        updatedAt: t.at,
      });
      await db.insert(messages).values([
        {
          id: `msg_${t.id}_q`,
          orgId: ORG,
          conversationId: t.id,
          role: "user",
          content: `${t.title}?`,
          createdAt: t.at,
          updatedAt: t.at,
        },
        {
          id: `msg_${t.id}_a`,
          orgId: ORG,
          conversationId: t.id,
          role: "assistant",
          content: `Here is how ${t.title.toLowerCase()} works.`,
          feedback: "up",
          model: "test/model",
          createdAt: new Date(t.at.getTime() + 1000),
          updatedAt: new Date(t.at.getTime() + 1000),
        },
      ]);
    }

    // Usage threads (spec: usage-page): anonymous, with context and topic labels.
    for (const t of USAGE.threads) {
      const at = daysAgo(t.day, now);
      const account = USAGE.accounts[t.account];
      await db.insert(conversations).values({
        id: t.id,
        orgId: ORG,
        projectId: PROJECT,
        sessionId: t.session,
        title: t.questions[0][0],
        context: { user_type: { id: t.userType }, account: { ...account } },
        createdAt: at,
        updatedAt: at,
      });
      await db.insert(messages).values(
        t.questions.flatMap(([question, topic], i) => {
          const asked = new Date(at.getTime() + i * 60_000);
          return [
            {
              id: `msg_${t.id}_q${i}`,
              orgId: ORG,
              conversationId: t.id,
              role: "user" as const,
              content: question,
              topic,
              createdAt: asked,
              updatedAt: asked,
            },
            {
              id: `msg_${t.id}_a${i}`,
              orgId: ORG,
              conversationId: t.id,
              role: "assistant" as const,
              content: `Here is how that works.`,
              model: "test/model",
              createdAt: new Date(asked.getTime() + 1000),
              updatedAt: new Date(asked.getTime() + 1000),
            },
          ];
        }),
      );
    }

    // Tool calls for the actions log (spec: actions-log): one server, four
    // calls on Visitor One's site thread, one per outcome the page names.
    const shop = SEED.actions.server;
    await db.insert(actionServers).values({
      id: shop.id,
      orgId: ORG,
      projectId: PROJECT,
      name: shop.name,
      slug: "seeded-shop",
      url: "http://127.0.0.1:8765/mcp",
      transport: "http",
      authKind: "none",
      identity: "none",
      enabled: true,
      policies: { order_status: "allow", cancel_order: "confirm" },
      labels: { order_status: "Look up your order", cancel_order: "Cancel your order" },
      tools: [
        {
          name: "order_status",
          description: "Looks up an order by its id.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string", title: "Order ID" } },
          },
          annotations: { readOnlyHint: true },
        },
        {
          name: "cancel_order",
          description: "Cancels an order.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string", title: "Order ID" } },
          },
        },
      ],
      toolsFetchedAt: now,
      status: "ok",
    });
    const thread = WIDGET.threads.v1Site;
    const base = daysAgo(1, now).getTime() + 2000;
    const call = (
      id: string,
      minutesAgo: number,
      over: Partial<typeof actionCalls.$inferInsert>,
    ): typeof actionCalls.$inferInsert => ({
      id,
      orgId: ORG,
      projectId: PROJECT,
      conversationId: thread.id,
      messageId: `msg_${thread.id}_a`,
      serverId: shop.id,
      tool: "order_status",
      title: "Look up your order",
      input: { id: "42" },
      status: "succeeded",
      endUserId: one.id,
      createdAt: new Date(base + minutesAgo * 60_000),
      updatedAt: new Date(base + minutesAgo * 60_000),
      ...over,
    });
    await db.insert(actionCalls).values([
      call(SEED.actions.calls.done, 0, {
        output: { id: "42", status: "shipped", carrier: "DHL" },
        latencyMs: 1234,
      }),
      call(SEED.actions.calls.failed, 1, {
        status: "failed",
        error: "upstream timed out after 30 s",
        latencyMs: 30_000,
      }),
      call(SEED.actions.calls.awaiting, 2, {
        tool: "cancel_order",
        title: "Cancel your order",
        status: "pending_approval",
        summary: "Cancel your order — id: 42",
        details: [{ label: "Order ID", value: "42" }],
        approvalId: "ap_e2e_awaiting",
        expiresAt: new Date(now.getTime() + 600_000),
      }),
      call(SEED.actions.calls.declined, 3, {
        tool: "cancel_order",
        title: "Cancel your order",
        status: "denied",
        summary: "Cancel your order — id: 41",
        input: { id: "41" },
        details: [{ label: "Order ID", value: "41" }],
        approvalId: "ap_e2e_declined",
        respondedAt: new Date(base + 4 * 60_000),
      }),
    ]);

    const analysis: StoredGapAnalysis = {
      ...SEED.analysis,
      suggestedFacts: [...SEED.analysis.suggestedFacts],
      model: "test/model",
      analyzedAt: daysAgo(1, now).toISOString(),
      inputHash: "e2e-seed",
    };
    // The written answer (spec: corrections-source): the source, the document
    // and, below, the resolved cluster that points at it.
    await db.insert(sources).values({
      id: SEED.corrections.sourceId,
      orgId: ORG,
      projectId: PROJECT,
      type: CORRECTIONS_SOURCE_TYPE,
      config: {},
      status: "ready",
      lastSyncedAt: daysAgo(5, now),
    });
    const hContent = correctionContent(SEED.clusters.H.label, SEED.corrections.H.answer);
    await db.insert(documents).values({
      id: SEED.corrections.H.documentId,
      orgId: ORG,
      sourceId: SEED.corrections.sourceId,
      url: null,
      title: SEED.clusters.H.label,
      contentHash: contentHash(hContent),
      content: hContent,
      createdAt: daysAgo(5, now),
      updatedAt: daysAgo(5, now),
    });

    const { A, B, C, D, E, F, G, H } = SEED.clusters;
    const cluster = (
      c: { id: string; label: string },
      firstSeen: Date,
      lastSeen: Date,
      extra: Partial<typeof gapClusters.$inferInsert> = {},
    ) => ({
      id: c.id,
      orgId: ORG,
      projectId: PROJECT,
      label: c.label,
      normalizedKey: c.label.toLowerCase().replace(/[?.!\s]+$/g, ""),
      firstSeen,
      lastSeen,
      ...extra,
    });
    await db.insert(gapClusters).values([
      cluster(A, daysAgo(13, now), daysAgo(12, now), { analysis }),
      cluster(B, now, now),
      cluster(C, daysAgo(3, now), daysAgo(3, now)),
      cluster(D, daysAgo(40, now), daysAgo(40, now), {
        status: "resolved",
        resolvedAt: daysAgo(35, now),
        resolvedBy: "seed",
      }),
      cluster(E, daysAgo(20, now), daysAgo(20, now)),
      cluster(F, daysAgo(100, now), daysAgo(100, now), {
        analysisRequestedAt: now,
        analysisRequestedBy: "seed",
      }),
      cluster(G, daysAgo(45, now), daysAgo(45, now), {
        analysisError: GAP_ANALYSIS_BUDGET_ERROR,
      }),
      cluster(H, daysAgo(8, now), daysAgo(8, now), {
        status: "resolved",
        resolvedAt: daysAgo(5, now),
        resolvedBy: "seed",
        correctionDocumentId: SEED.corrections.H.documentId,
      }),
    ]);

    interface Gap {
      id: string;
      question: string;
      at: Date;
      clusterId: string;
      assistant: Partial<typeof messages.$inferInsert>;
      citations?: unknown[];
      /** The answer's text; a plain sentence unless a test reads its Markdown. */
      content?: string;
    }
    const doc = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
      documentId: id,
      url: `https://docs.example.test/${id}`,
      title,
      snippet: `${title} …`,
      ...extra,
    });
    // B's answer also cited the written answer (spec: answer-citation-labels):
    // no URL, the question as its title, and the source kind that labels it.
    const writtenAnswer = {
      documentId: SEED.corrections.H.documentId,
      title: SEED.clusters.H.label,
      snippet: `${SEED.clusters.H.label} …`,
      kind: CORRECTIONS_SOURCE_TYPE,
    };
    const gaps: Gap[] = [
      {
        id: "a1",
        question: A.label,
        at: daysAgo(13, now),
        clusterId: A.id,
        assistant: { refused: true, refusalReason: "no_context", retrievalHits: 0 },
        citations: [],
      },
      {
        id: "a2",
        question: "Exporting feeds — how?",
        at: daysAgo(12, now),
        clusterId: A.id,
        assistant: {
          refused: true,
          refusalReason: "no_grounding",
          retrievalHits: 8,
          retrievalTopScore: 0.31,
        },
        citations: [doc("imports", "Importing a feed")],
      },
      {
        id: "b1",
        question: B.label,
        at: now,
        clusterId: B.id,
        // Markdown, as the model writes it: the thread page renders the list
        // (spec: conversations-inbox-polish).
        content:
          "The key is under **Settings › Install**:\n\n- Copy the project key\n- Paste it into the snippet",
        assistant: {
          refused: false,
          feedback: "down",
          feedbackReason: "incorrect",
          feedbackComment: "That is the project key, not the API key.",
          retrievalHits: 8,
          retrievalTopScore: 0.52,
          sourcesNamed: true,
        },
        citations: [doc("keys", "Project keys"), writtenAnswer],
      },
      {
        id: "c1",
        question: C.label,
        at: daysAgo(3, now),
        clusterId: C.id,
        assistant: {
          refused: false,
          retrievalHits: 8,
          retrievalTopScore: 0.2,
          sourcesNamed: false,
        },
        citations: [doc("pricing", "Pricing overview")],
      },
      {
        id: "d1",
        question: D.label,
        at: daysAgo(40, now),
        clusterId: D.id,
        assistant: { refused: true, refusalReason: "no_context", retrievalHits: 0 },
        citations: [],
      },
      {
        id: "e1",
        question: E.label,
        at: daysAgo(20, now),
        clusterId: E.id,
        assistant: { refused: true },
        citations: [],
      },
      {
        id: "f1",
        question: F.label,
        at: daysAgo(100, now),
        clusterId: F.id,
        assistant: { refused: true, refusalReason: "no_context", retrievalHits: 0 },
        citations: [],
      },
      {
        id: "g1",
        question: G.label,
        at: daysAgo(45, now),
        clusterId: G.id,
        assistant: { refused: true, refusalReason: "no_context", retrievalHits: 0 },
        citations: [],
      },
      {
        id: "h1",
        question: H.label,
        at: daysAgo(8, now),
        clusterId: H.id,
        assistant: { refused: true, refusalReason: "no_context", retrievalHits: 0 },
        citations: [],
      },
    ];
    for (const g of gaps) {
      const conversationId = `conv_e2e_${g.id}`;
      await db.insert(conversations).values({
        id: conversationId,
        orgId: ORG,
        projectId: PROJECT,
        sessionId: "e2e",
        createdAt: g.at,
        updatedAt: g.at,
      });
      await db.insert(messages).values([
        {
          id: `msg_e2e_${g.id}_q`,
          orgId: ORG,
          conversationId,
          role: "user",
          content: g.question,
          createdAt: g.at,
          updatedAt: g.at,
        },
        {
          id: `msg_e2e_${g.id}_a`,
          orgId: ORG,
          conversationId,
          role: "assistant",
          content: g.assistant.refused ? "" : (g.content ?? "An answer."),
          citations: g.citations ?? null,
          gapClusterId: g.clusterId,
          model: "test/model",
          createdAt: new Date(g.at.getTime() + 1000),
          updatedAt: new Date(g.at.getTime() + 1000),
          ...g.assistant,
        },
      ]);
    }
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedBrowserSuite()
    .then(() => console.log(`seeded ${e2eDatabaseUrl()}`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
