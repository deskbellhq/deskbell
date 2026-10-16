/**
 * Calibrates the weak-answer floor (spec: answer-signal).
 *
 * Joins a retrieval-only report, which carries each case's top retrieval
 * score, with a judged report of the same question set, which carries each
 * case's grade. For every candidate floor it prints what flagging "top score
 * under the floor" would have done: how many wrong or refused answers it
 * catches, and how many correct answers it flags. The output is evidence for
 * choosing the default; nothing here writes anything.
 *
 * Usage:
 *   pnpm exec tsx scripts/measure-weak-score.ts \
 *     --scores packages/evals/reports/weak-scores.json \
 *     --judged packages/evals/reports/x.json \
 *     [--floors 0.30,0.35,0.40,0.45,0.50,0.55,0.60]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { EvalCaseResult, EvalReport } from "../packages/evals/src/types";

const { values } = parseArgs({
  options: {
    scores: { type: "string" },
    judged: { type: "string" },
    floors: { type: "string", default: "0.30,0.35,0.40,0.45,0.50,0.55,0.60" },
  },
});

if (!values.scores || !values.judged) {
  console.error("usage: tsx scripts/measure-weak-score.ts --scores <json> --judged <json>");
  process.exit(2);
}

const read = (path: string) => JSON.parse(readFileSync(resolve(path), "utf8")) as EvalReport;
const scores = read(values.scores);
const judged = read(values.judged);
const floors = values.floors
  .split(",")
  .map((f) => Number(f.trim()))
  .filter((f) => Number.isFinite(f));

interface Joined {
  id: string;
  top: number;
  grade: EvalCaseResult["grade"];
  refused: boolean;
}

const byId = new Map(judged.cases.map((r) => [r.id, r]));
const joined: Joined[] = [];
let unscored = 0;
for (const r of scores.cases) {
  if (r.kind !== "answerable") continue;
  const j = byId.get(r.id);
  if (!j) continue;
  if (r.retrievedTopScore === null || r.retrievedTopScore === undefined) {
    unscored += 1;
    continue;
  }
  joined.push({ id: r.id, top: r.retrievedTopScore, grade: j.grade, refused: j.refused });
}

if (joined.length === 0) {
  console.error(
    "no answerable cases joined — does the scores report carry retrievedTopScore, and do the ids match?",
  );
  process.exit(1);
}

const fmt = (n: number) => n.toFixed(3);
const pct = (n: number, d: number) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(0)}%`);

console.log(`# Weak-answer floor calibration\n`);
console.log(
  `Scores: ${values.scores} (${scores.retrievalConfig ? "config recorded" : "no config"})`,
);
console.log(`Judged: ${values.judged} (judge ${judged.judge ?? "?"})`);
console.log(
  `Joined ${joined.length} answerable cases; ${unscored} without a top score were left out.\n`,
);

// Grade by top-score decile: the shape of the relationship before any floor.
console.log("## Grade by top-score band\n");
console.log("| top score | cases | A | B | C | refused | mean top |");
console.log("|---|---|---|---|---|---|---|");
const bands = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 1.01];
for (let i = 0; i < bands.length - 1; i++) {
  const lo = bands[i] as number;
  const hi = bands[i + 1] as number;
  const rows = joined.filter((r) => r.top >= lo && r.top < hi);
  if (rows.length === 0) continue;
  const count = (g: EvalCaseResult["grade"]) =>
    rows.filter((r) => !r.refused && r.grade === g).length;
  const refused = rows.filter((r) => r.refused).length;
  const mean = rows.reduce((s, r) => s + r.top, 0) / rows.length;
  console.log(
    `| ${fmt(lo)}–${fmt(Math.min(hi, 1))} | ${rows.length} | ${count("A")} | ${count("B")} | ${count("C")} | ${refused} | ${fmt(mean)} |`,
  );
}

// Per floor: "flag when top < floor" against "the answer was wrong or refused".
const bad = joined.filter((r) => r.refused || r.grade === "C");
const good = joined.filter((r) => !r.refused && r.grade === "A");
console.log("\n## Candidate floors\n");
console.log(
  "Positive = top score under the floor. Wrong = graded C or refused. Correct = graded A.\n",
);
console.log(
  "| floor | flagged | wrong caught | of all wrong | correct flagged | of all correct | precision |",
);
console.log("|---|---|---|---|---|---|---|");
for (const floor of floors) {
  const flagged = joined.filter((r) => r.top < floor);
  const caught = flagged.filter((r) => r.refused || r.grade === "C").length;
  const falseWeak = flagged.filter((r) => !r.refused && r.grade === "A").length;
  console.log(
    `| ${fmt(floor)} | ${flagged.length} | ${caught} | ${pct(caught, bad.length)} | ${falseWeak} | ${pct(falseWeak, good.length)} | ${pct(caught, flagged.length)} |`,
  );
}
console.log(`\nWrong answers in the set: ${bad.length}; correct answers: ${good.length}.`);
