import { describe, expect, it } from "vitest";

import {
  exportFilename,
  type LogRow,
  logHref,
  resolveId,
  resolveLogStatus,
  STATUS_VIEW,
  shortQuestion,
  toCsv,
} from "./log";

describe("actions log view (spec: actions-log)", () => {
  it("reads the status from the URL and falls back to all", () => {
    expect(resolveLogStatus("failed")).toBe("failed");
    expect(resolveLogStatus(["expired", "done"])).toBe("expired");
    expect(resolveLogStatus("nope")).toBe("all");
    expect(resolveLogStatus(undefined)).toBe("all");
  });

  it("maps every stored status to exactly one view", () => {
    const covered = Object.values(STATUS_VIEW).flat();
    expect([...covered].sort()).toEqual(
      [
        "approved",
        "denied",
        "expired",
        "failed",
        "pending_approval",
        "running",
        "succeeded",
      ].sort(),
    );
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("reads one trimmed id, or null", () => {
    expect(resolveId(" srv_1 ")).toBe("srv_1");
    expect(resolveId(["a", "b"])).toBe("a");
    expect(resolveId("")).toBeNull();
    expect(resolveId(undefined)).toBeNull();
  });

  it("builds a link that omits defaults", () => {
    expect(logHref("/actions", { period: "30d", status: "all" }, "30d")).toBe("/actions");
    expect(
      logHref(
        "/actions",
        { period: "7d", status: "failed", server: "srv_1", tool: "cancel" },
        "30d",
      ),
    ).toBe("/actions?period=7d&status=failed&server=srv_1&tool=cancel");
    expect(logHref("/actions", { call: "act_1" }, "30d")).toBe("/actions?call=act_1");
  });

  it("writes a CSV with JSON cells and quoted commas", () => {
    const row: LogRow = {
      id: "act_1",
      createdAt: new Date("2026-09-22T10:00:00Z"),
      respondedAt: null,
      expiresAt: null,
      serverId: "srv_1",
      serverName: "Shop, EU",
      tool: "cancel_order",
      title: "Cancel your order",
      status: "succeeded",
      latencyMs: 1234,
      conversationId: "conv_1",
      messageId: "msg_1",
      question: "cancel order 42",
      visitorId: null,
      visitorName: null,
      input: { id: "42" },
      details: [{ label: "Order ID", value: "42" }],
      output: { ok: true },
      outputTruncated: false,
      error: null,
    };
    const csv = toCsv([row]);
    const [header, line] = csv.trimEnd().split("\n");
    expect(header).toBe(
      "id,created_at,server,tool,title,status,latency_ms,conversation_id,message_id,visitor_id,input,output,output_truncated,error,responded_at",
    );
    expect(line).toBe(
      'act_1,2026-09-22T10:00:00.000Z,"Shop, EU",cancel_order,Cancel your order,succeeded,1234,conv_1,msg_1,,"{""id"":""42""}","{""ok"":true}",false,,',
    );
  });

  it("names the file by period, status and day", () => {
    const now = new Date("2026-09-22T21:00:00Z");
    expect(exportFilename({ period: "30d", status: "all" }, now)).toBe(
      "deskbell-actions-30d-2026-09-22.csv",
    );
    expect(exportFilename({ period: "all", status: "failed" }, now)).toBe(
      "deskbell-actions-all-failed-2026-09-22.csv",
    );
  });

  it("cuts a question for a cell", () => {
    expect(shortQuestion("  where is\nmy order ")).toBe("where is my order");
    expect(shortQuestion("x".repeat(100), 20)).toHaveLength(20);
    expect(shortQuestion(null)).toBeNull();
  });
});
