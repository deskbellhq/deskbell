import type { AnswerEvent } from "@deskbell/shared";

/**
 * Reads `data: {json}\n\n` frames off the ask stream.
 *
 * Not `EventSource`: the ask endpoint takes a POST body. Frames may be split
 * across chunks, so decoding is streaming and a partial frame waits for the
 * next read. Comment lines (`: open`, `: ping`, spec: sse-heartbeat) carry no
 * `data:` prefix and are ignored, and one malformed frame is skipped rather
 * than failing the whole answer.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AnswerEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (frame.startsWith("data: ")) {
        try {
          yield JSON.parse(frame.slice(6)) as AnswerEvent;
        } catch {
          // skip malformed frame
        }
      }
      idx = buffer.indexOf("\n\n");
    }
  }
}
