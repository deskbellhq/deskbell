import { describe, expect, it } from "vitest";
import { readQueue } from "./queue";

describe("readQueue", () => {
  it("reads the queue off the stub, which is a function carrying .q", () => {
    // The documented stub: window.deskbell = function(){ (deskbell.q ??= []).push(arguments) }
    const stub = Object.assign(
      () => {
        /* queues */
      },
      { q: [["open"], ["ask", "how?"]] as Array<[string, unknown?]> },
    );
    expect(readQueue(stub)).toEqual([["open"], ["ask", "how?"]]);
  });

  it("returns nothing for a live dispatcher, an absent global, or junk", () => {
    expect(readQueue(() => {})).toEqual([]);
    expect(readQueue(undefined)).toEqual([]);
    expect(readQueue({ q: "not an array" })).toEqual([]);
  });

  it("copies, so replaying cannot be disturbed by later pushes", () => {
    const q: Array<[string, unknown?]> = [["open"]];
    const read = readQueue(Object.assign(() => {}, { q }));
    q.push(["close"]);
    expect(read).toEqual([["open"]]);
  });
});
