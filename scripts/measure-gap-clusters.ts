/**
 * Measures the cluster similarity threshold (spec: gap-clusters).
 *
 * Embeds every gap question in a project — and, optionally, the questions
 * of an eval dataset as extra material — then prints every pair above a low
 * floor with its cosine similarity, and the clusters assignment would form at
 * several thresholds. A person reads the pairs in the ambiguous band, labels
 * them "same need" or "different", and picks the highest threshold that
 * merges paraphrases without merging different needs. Nothing here writes to
 * the database.
 *
 * It embeds and groups the way the worker does (spec:
 * gap-cluster-members-and-ignored-terms): the project's ignored terms are
 * removed before embedding, and a question joins a cluster when it is close
 * enough to ANY of its wordings. `--no-strip` and `--leader-only` turn each
 * off, which is how the two were measured against the old behaviour.
 *
 * Usage:
 *   pnpm exec tsx --env-file-if-exists=.env scripts/measure-gap-clusters.ts \
 *     --project proj_dev [--dataset packages/evals/datasets/x.json] \
 *     [--floor 0.5] [--thresholds 0.80,0.85,0.88,0.90,0.93] \
 *     [--no-strip] [--leader-only] [--terms "Deskbell,Acme"]
 */
import { parseArgs } from "node:util";
import { and, eq, isNull, or } from "drizzle-orm";
import { createEmbedder } from "../packages/core/src/models";
import {
  conversations,
  createDb,
  gapQuestionSql,
  isGapPredicate,
  messages,
  normalizeQuestion,
  projects,
  readGapsConfig,
  readIgnoredTerms,
  stripIgnoredTerms,
} from "../packages/db/src";
import { loadDataset } from "../packages/evals/src/dataset";

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    dataset: { type: "string" },
    floor: { type: "string", default: "0.5" },
    thresholds: { type: "string", default: "0.80,0.85,0.88,0.90,0.93" },
    "no-strip": { type: "boolean", default: false },
    "leader-only": { type: "boolean", default: false },
    terms: { type: "string" },
  },
});

if (!values.project) {
  console.error("usage: tsx scripts/measure-gap-clusters.ts --project <id> [--dataset <json>]");
  process.exit(2);
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / Math.sqrt(na * nb);
};

async function main() {
  const db = createDb();
  try {
    const [project] = await db
      .select({ id: projects.id, orgId: projects.orgId })
      .from(projects)
      .where(eq(projects.id, values.project as string))
      .limit(1);
    if (!project) throw new Error(`no project with id ${values.project}`);

    const { weakScore } = readGapsConfig();
    const rows = await db
      .select({ question: gapQuestionSql })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.orgId, project.orgId),
          eq(conversations.projectId, project.id),
          isGapPredicate(weakScore),
          or(isNull(messages.gapClusterId), eq(messages.refused, messages.refused)),
        ),
      );

    const seen = new Map<string, string>();
    for (const r of rows) {
      const q = r.question?.trim();
      if (q && !seen.has(normalizeQuestion(q))) seen.set(normalizeQuestion(q), q);
    }
    let fromDataset = 0;
    if (values.dataset) {
      const dataset = await loadDataset(values.dataset);
      for (const c of dataset.cases) {
        const key = normalizeQuestion(c.question);
        if (!seen.has(key)) {
          seen.set(key, c.question);
          fromDataset += 1;
        }
      }
    }
    const questions = [...seen.values()];
    console.log(
      `# Cluster similarity measurement\n\n${questions.length} distinct questions ` +
        `(${questions.length - fromDataset} from the project, ${fromDataset} from the dataset).`,
    );

    const terms = values["no-strip"]
      ? []
      : values.terms
        ? values.terms.split(",").map((t) => t.trim())
        : await readIgnoredTerms(db, { orgId: project.orgId, projectId: project.id });
    const embedded = questions.map((q) => stripIgnoredTerms(q, terms));

    const embedder = createEmbedder();
    console.log(`Embedding model: ${embedder.modelId}`);
    console.log(`Ignored terms: ${terms.length ? terms.join(", ") : "(none)"}`);
    console.log(`Comparison: ${values["leader-only"] ? "cluster leaders" : "every wording"}\n`);
    const vectors: number[][] = [];
    for (let i = 0; i < embedded.length; i += 64) {
      vectors.push(...(await embedder.embedMany(embedded.slice(i, i + 64))));
    }

    const floor = Number(values.floor);
    const pairs: Array<{ a: number; b: number; sim: number }> = [];
    for (let a = 0; a < questions.length; a++) {
      for (let b = a + 1; b < questions.length; b++) {
        const sim = cosine(vectors[a] as number[], vectors[b] as number[]);
        if (sim >= floor) pairs.push({ a, b, sim });
      }
    }
    pairs.sort((x, y) => y.sim - x.sim);

    console.log(`## Pairs at or above ${floor.toFixed(2)} (${pairs.length})\n`);
    console.log("| sim | question | question |");
    console.log("|---|---|---|");
    for (const p of pairs) {
      console.log(`| ${p.sim.toFixed(3)} | ${questions[p.a]} | ${questions[p.b]} |`);
    }

    const thresholds = values.thresholds
      .split(",")
      .map((t) => Number(t.trim()))
      .filter((t) => Number.isFinite(t));
    for (const t of thresholds) {
      // Greedy assignment in first-seen order, as the worker does it: the
      // nearest wording of any cluster decides, unless --leader-only asks for
      // the pre-2026-09-22 comparison.
      const leaders: number[] = [];
      const members = new Map<number, number[]>();
      for (let i = 0; i < questions.length; i++) {
        let joined: number | null = null;
        let best = -1;
        for (const l of leaders) {
          const against = values["leader-only"] ? [l] : (members.get(l) as number[]);
          for (const m of against) {
            const sim = cosine(vectors[i] as number[], vectors[m] as number[]);
            if (sim > best) {
              best = sim;
              joined = sim >= t ? l : null;
            }
          }
        }
        if (joined === null) {
          leaders.push(i);
          members.set(i, [i]);
        } else {
          members.get(joined)?.push(i);
        }
      }
      const multi = [...members.entries()].filter(([, m]) => m.length > 1);
      console.log(
        `\n## Threshold ${t.toFixed(2)}: ${leaders.length} clusters, ${multi.length} with more than one phrasing\n`,
      );
      for (const [l, m] of multi) {
        console.log(`- **${questions[l]}**`);
        for (const i of m.slice(1)) console.log(`  - ${questions[i]}`);
      }
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
