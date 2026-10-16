import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ownedBy } from "./conversation-access";

const render = (caller: Parameters<typeof ownedBy>[0]) =>
  new PgDialect().sqlToQuery(ownedBy(caller));

describe("ownedBy", () => {
  it("binds anonymous callers to their session and excludes deleted rows", () => {
    const q = render({ sessionId: "s1", endUser: null });
    expect(q.sql).toContain('"session_id" = $1');
    expect(q.sql).toContain('"deleted_at" is null');
    expect(q.sql).not.toContain("end_user_id");
    expect(q.params).toEqual(["s1"]);
  });

  it("binds verified callers to their end-user id, never the session", () => {
    const q = render({ sessionId: "s1", endUser: { id: "eu_1" } });
    expect(q.sql).toContain('"end_user_id" = $1');
    expect(q.sql).not.toContain("session_id");
    expect(q.params).toEqual(["eu_1"]);
  });
});

describe("titleFromQuestion", () => {
  it("collapses whitespace and caps at 80 characters", async () => {
    const { titleFromQuestion } = await import("./conversation");
    expect(titleFromQuestion("  How do\n I  export? ")).toBe("How do I export?");
    const long = titleFromQuestion("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
  });
});
