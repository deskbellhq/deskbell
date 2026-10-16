import { createDb, gapQuestionSql, messages } from "@deskbell/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

/**
 * Regression net for the correlated subquery (spec: gap-clusters). Rendered
 * without a join, Drizzle drops the table qualifier from column references;
 * if the fragment relied on them, `u.conversation_id = "conversation_id"`
 * would compare the alias with itself and every row would get the newest
 * user message in the table. `toSQL` needs no connection.
 */
describe("gapQuestionSql", () => {
  it("correlates on the outer messages table even in a join-free query", () => {
    const db = createDb("postgres://unused:unused@localhost:1/unused");
    const { sql } = db
      .select({ question: gapQuestionSql })
      .from(messages)
      .where(eq(messages.id, "x"))
      .toSQL();

    expect(sql).toContain('u.conversation_id = "messages"."conversation_id"');
    expect(sql).toContain('u.created_at <= "messages"."created_at"');
    expect(sql).not.toMatch(/u\.conversation_id = "conversation_id"/);
  });
});
