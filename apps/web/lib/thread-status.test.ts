import { describe, expect, it } from "vitest";
import { threadStatus, threadStatusDetail } from "./thread-status";

const thread = (over: Partial<Parameters<typeof threadStatus>[0]>) => ({
  answers: 1,
  refusals: 0,
  weak: 0,
  turns: 1,
  ...over,
});

describe("threadStatus", () => {
  it("is unanswered until an assistant message exists", () => {
    expect(threadStatus(thread({ answers: 0 }))).toBe("unanswered");
  });

  it("is certain only when nothing refused and nothing was weak", () => {
    expect(threadStatus(thread({}))).toBe("certain");
    expect(threadStatus(thread({ refusals: 1 }))).toBe("uncertain");
    expect(threadStatus(thread({ weak: 1 }))).toBe("uncertain");
    expect(threadStatus(thread({ unsupported: 1 }))).toBe("uncertain");
  });

  it("lets one uncertain answer mark a long thread", () => {
    expect(threadStatus(thread({ answers: 4, turns: 4, refusals: 1 }))).toBe("uncertain");
    expect(threadStatus(thread({ answers: 4, turns: 4, weak: 1 }))).toBe("uncertain");
  });
});

describe("threadStatusDetail", () => {
  it("says nothing for certain and unanswered threads", () => {
    expect(threadStatusDetail(thread({}))).toBeNull();
    expect(threadStatusDetail(thread({ answers: 0 }))).toBeNull();
  });

  it("names the reason on a single turn", () => {
    expect(threadStatusDetail(thread({ refusals: 1 }))).toBe("refused");
    expect(threadStatusDetail(thread({ weak: 1 }))).toBe("weak grounding");
    expect(threadStatusDetail(thread({ unsupported: 1 }))).toBe("unsupported name");
  });

  it("gives the shape on a longer thread", () => {
    expect(threadStatusDetail(thread({ answers: 4, turns: 4, refusals: 1 }))).toBe(
      "1 of 4 refused",
    );
    expect(threadStatusDetail(thread({ answers: 4, turns: 4, refusals: 1, weak: 1 }))).toBe(
      "1 of 4 refused · 1 weak",
    );
    expect(threadStatusDetail(thread({ answers: 3, turns: 3, weak: 2 }))).toBe("2 weak");
    expect(threadStatusDetail(thread({ answers: 3, turns: 3, refusals: 1, unsupported: 1 }))).toBe(
      "1 of 3 refused · 1 unsupported",
    );
  });
});
