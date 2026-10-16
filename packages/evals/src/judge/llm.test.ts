import { describe, expect, it } from "vitest";
import type { EvalCase, TargetAnswer } from "../types";
import { createLlmJudge } from "./llm";

const verdict = JSON.stringify({
  facts: [{ fact: "alpha", present: true }],
  grounded: true,
  reason: "says alpha",
});

const answer: TargetAnswer = {
  answer: "alpha here",
  refused: false,
  citedDocumentIds: [],
  retrieved: [{ chunkId: "c1", documentId: "d1", score: 0.9, content: "alpha is a thing" }],
  usage: { input: 0, output: 0, embedding: 0 },
  latencyMs: 1,
};

const evalCase: EvalCase = {
  id: "c",
  question: "which one then?",
  kind: "answerable",
  expectedFacts: ["alpha"],
};

/** Captures what the judge asked, and answers with a fixed verdict. */
function judgeWith() {
  const prompts: string[] = [];
  const judge = createLlmJudge({
    modelId: "m",
    async complete({ prompt }) {
      prompts.push(prompt);
      return verdict;
    },
  });
  return { judge, prompts };
}

describe("createLlmJudge — the prompt", () => {
  it("shows the judge the thread when a follow-up case carries one", async () => {
    // "which one then?" is unreadable alone (spec: answer-verification).
    const { judge, prompts } = judgeWith();
    await judge.grade(
      {
        ...evalCase,
        history: [
          { role: "user", content: "how do I move it?" },
          { role: "assistant", content: "Use position." },
        ],
      },
      answer,
    );
    expect(prompts[0]).toContain(
      "Conversation so far:\nVisitor: how do I move it?\nAssistant: Use position.",
    );
    expect(prompts[0]?.indexOf("Conversation so far")).toBeLessThan(
      prompts[0]?.indexOf("Question:") ?? -1,
    );
  });

  it("asks exactly as before when there is no history", async () => {
    const { judge, prompts } = judgeWith();
    const graded = await judge.grade(evalCase, answer);
    expect(prompts[0]?.startsWith("Question: which one then?")).toBe(true);
    expect(prompts[0]).not.toContain("Conversation so far");
    expect(graded.grade).toBe("A");
    expect(graded.grounded).toBe(true);
  });
});
