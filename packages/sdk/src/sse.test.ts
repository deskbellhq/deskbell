import { describe, expect, it } from "vitest";
import { readSse } from "./sse.ts";

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const event of readSse(body)) out.push(event);
  return out;
}

describe("readSse", () => {
  it("parses one frame per blank line", async () => {
    const events = await collect(
      stream([
        'data: {"type":"token","value":"Hi"}\n\ndata: {"type":"done","conversationId":"c","messageId":"m"}\n\n',
      ]),
    );
    expect(events).toEqual([
      { type: "token", value: "Hi" },
      { type: "done", conversationId: "c", messageId: "m" },
    ]);
  });

  it("reassembles a frame split across chunks", async () => {
    const events = await collect(stream(['data: {"type":"tok', 'en","value":"a"}\n', "\n"]));
    expect(events).toEqual([{ type: "token", value: "a" }]);
  });

  it("ignores comment lines and skips malformed frames", async () => {
    const events = await collect(
      stream([
        ": open\n\n",
        "data: not json\n\n",
        ': ping\n\ndata: {"type":"token","value":"b"}\n\n',
      ]),
    );
    expect(events).toEqual([{ type: "token", value: "b" }]);
  });

  it("drops a trailing partial frame without a terminator", async () => {
    const events = await collect(stream(['data: {"type":"token","value":"x"}']));
    expect(events).toEqual([]);
  });
});
