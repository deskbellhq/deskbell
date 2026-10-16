import { describe, expect, it } from "vitest";

import {
  ActionLabelsSchema,
  actionDetails,
  actionToolTitle,
  actionVisitorLabel,
  humanizeKey,
} from "./actions";

describe("actionToolTitle (spec: action-presentation)", () => {
  it("prefers the tool's title, then the annotation, then a readable name", () => {
    expect(actionToolTitle({ name: "x", title: "Order status" })).toBe("Order status");
    expect(actionToolTitle({ name: "x", annotations: { title: "Look up" } })).toBe("Look up");
    expect(actionToolTitle({ name: "ask_wiki_question" })).toBe("Ask wiki question");
    expect(actionToolTitle({ name: "cancel-order" })).toBe("Cancel order");
    expect(actionToolTitle({ name: "x", title: "  " })).toBe("X");
  });
});

describe("actionVisitorLabel", () => {
  const tool = { name: "order_status" };
  it("uses the operator's label when set, else the derived title", () => {
    expect(actionVisitorLabel(tool, { order_status: "Look up your order" })).toBe(
      "Look up your order",
    );
    expect(actionVisitorLabel(tool, { other: "x" })).toBe("Order status");
    expect(actionVisitorLabel(tool, null)).toBe("Order status");
    expect(actionVisitorLabel(tool, { order_status: "   " })).toBe("Order status");
  });
  it("cuts a label to the limit", () => {
    expect(actionVisitorLabel(tool, { order_status: "a".repeat(80) })).toHaveLength(60);
  });
});

describe("ActionLabelsSchema", () => {
  it("trims, and refuses blank or overlong labels", () => {
    expect(ActionLabelsSchema.parse({ a: " Look up " })).toEqual({ a: "Look up" });
    expect(ActionLabelsSchema.safeParse({ a: "  " }).success).toBe(false);
    expect(ActionLabelsSchema.safeParse({ a: "x".repeat(61) }).success).toBe(false);
  });
});

describe("humanizeKey", () => {
  it("splits camel and snake case and upper-cases known initialisms", () => {
    expect(humanizeKey("repoName")).toBe("Repo name");
    expect(humanizeKey("order_id")).toBe("Order ID");
    expect(humanizeKey("id")).toBe("ID");
    expect(humanizeKey("customerURL")).toBe("Customer URL");
    expect(humanizeKey("question")).toBe("Question");
    expect(humanizeKey("HTMLBody")).toBe("Html body");
    expect(humanizeKey("_")).toBe("_");
  });
});

describe("actionDetails", () => {
  it("names rows from the schema title, else the key, and renders values as text", () => {
    expect(
      actionDetails(
        { repoName: "vercel/ai", question: "What is it?", count: 3, flag: true, skip: null },
        {
          type: "object",
          properties: { repoName: { type: "string", title: "Repository" }, question: {} },
        },
      ),
    ).toEqual([
      { label: "Repository", value: "vercel/ai" },
      { label: "Question", value: "What is it?" },
      { label: "Count", value: "3" },
      { label: "Flag", value: "true" },
    ]);
  });
  it("joins scalar arrays, stringifies objects, skips empties, caps rows and values", () => {
    expect(actionDetails({ tags: ["a", "b"], meta: { k: 1 }, empty: "" })).toEqual([
      { label: "Tags", value: "a, b" },
      { label: "Meta", value: '{"k":1}' },
    ]);
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, "v"]));
    expect(actionDetails(many)).toHaveLength(12);
    const [long] = actionDetails({ text: "x".repeat(300) });
    expect(long?.value).toHaveLength(200);
    expect(long?.value.endsWith("…")).toBe(true);
  });
  it("returns nothing for a non-object input", () => {
    expect(actionDetails(null)).toEqual([]);
    expect(actionDetails("x")).toEqual([]);
    expect(actionDetails([1, 2])).toEqual([]);
  });
});
