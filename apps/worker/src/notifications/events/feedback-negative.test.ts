import { describe, expect, it } from "vitest";
import {
  buildFeedbackNegative,
  type FeedbackMaterial,
  type FeedbackNegativeDeps,
} from "./feedback-negative";

function material(over: Partial<FeedbackMaterial["message"]> = {}): FeedbackMaterial {
  return {
    project: { id: "proj_1", name: "Docs", reasonLabels: { slow: "Too slow" }, notifications: {} },
    conversation: {
      id: "conv_1",
      title: "Exporting a feed",
      context: { site: { id: "42", name: "Shop" } },
    },
    message: {
      id: "msg_1",
      createdAt: new Date("2026-09-18T09:59:00.000Z"),
      answer: "Open the menu.",
      feedback: "down",
      reason: "incorrect",
      comment: "wrong menu",
      ...over,
    },
    question: "How do I export a feed?",
  };
}

function fake(
  opts: {
    material?: FeedbackMaterial | null;
    limit?: number;
    used?: number;
    summarizer?: "ok" | "empty" | "throws" | null;
  } = {},
) {
  const usage: Array<{ input: number; output: number }> = [];
  let calls = 0;
  const deps: FeedbackNegativeDeps = {
    async load() {
      return opts.material === undefined ? material() : opts.material;
    },
    async budget() {
      return { limit: opts.limit ?? 0, usedToday: opts.used ?? 0 };
    },
    summarizer:
      opts.summarizer === null
        ? null
        : {
            modelId: "test/model",
            async summarize(_input, o) {
              calls += 1;
              o?.onUsage?.({ input: 50, output: 12 });
              if (opts.summarizer === "throws") throw new Error("boom");
              return opts.summarizer === "empty" ? "" : "The answer named the wrong menu.";
            },
          },
    async recordUsage(u) {
      usage.push(u);
    },
    now: () => new Date("2026-09-18T10:00:00.000Z"),
  };
  return { deps, usage, calls: () => calls };
}

const subject = { messageId: "msg_1", conversationId: "conv_1" };
const base = "https://deskbell.example";

describe("buildFeedbackNegative", () => {
  it("builds the event with a model summary, labels and the dashboard link", async () => {
    const f = fake();
    const r = await buildFeedbackNegative(f.deps, subject, base);
    expect(r.event?.type).toBe("feedback.negative");
    // The same subject gets the same id on a retry: the receiver's idempotency key holds.
    expect(r.event?.id).toBe((await buildFeedbackNegative(fake().deps, subject, base)).event?.id);
    expect(r.event?.url).toBe("https://deskbell.example/conversations/conv_1");
    expect(r.event?.data.feedback.reasonLabel).toBe("Inaccurate");
    expect(r.event?.data.summary).toEqual({
      text: "The answer named the wrong menu.",
      source: "model",
    });
    expect(f.usage).toEqual([{ input: 50, output: 12 }]);
  });

  it("prefers the project's own reason labels and honours the link template", async () => {
    const m = material({ reason: "slow" });
    m.project.notifications = {
      conversationLinkTemplate: "https://app.example/s/{context.site.id}/c/{conversationId}",
    };
    const r = await buildFeedbackNegative(fake({ material: m }).deps, subject, base);
    expect(r.event?.data.feedback.reasonLabel).toBe("Too slow");
    expect(r.event?.url).toBe("https://app.example/s/42/c/conv_1");
  });

  it("falls back to the title when the budget is spent, the model fails, or summaries are off", async () => {
    const spent = fake({ limit: 100, used: 100 });
    expect((await buildFeedbackNegative(spent.deps, subject, base)).event?.data.summary).toEqual({
      text: "Exporting a feed",
      source: "title",
    });
    expect(spent.calls()).toBe(0);
    const failed = fake({ summarizer: "throws" });
    expect(
      (await buildFeedbackNegative(failed.deps, subject, base)).event?.data.summary.source,
    ).toBe("title");
    expect(failed.usage).toEqual([{ input: 50, output: 12 }]);
    const off = fake({ summarizer: null });
    expect((await buildFeedbackNegative(off.deps, subject, base)).event?.data.summary.source).toBe(
      "title",
    );
    const untitled = material();
    untitled.conversation.title = null;
    const q = fake({ material: untitled, summarizer: "empty" });
    expect((await buildFeedbackNegative(q.deps, subject, base)).event?.data.summary).toEqual({
      text: "How do I export a feed?",
      source: "question",
    });
  });

  it("returns nothing for a withdrawn vote or a missing row", async () => {
    expect(
      await buildFeedbackNegative(
        fake({ material: material({ feedback: null }) }).deps,
        subject,
        base,
      ),
    ).toEqual({
      event: null,
      reason: "withdrawn",
    });
    expect(await buildFeedbackNegative(fake({ material: null }).deps, subject, base)).toEqual({
      event: null,
      reason: "missing",
    });
    expect(await buildFeedbackNegative(fake().deps, {}, base)).toEqual({
      event: null,
      reason: "missing",
    });
  });
});
