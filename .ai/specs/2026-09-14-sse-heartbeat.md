# SSE heartbeat on the answer stream

> Status: done · 2026-09-14

**Goal.** `/api/v1/ask` streams events, but nothing reaches the client until
the first event, and the first event is the first token. Until then the
response headers are not flushed, so the widget cannot tell a slow answer
from a server that will never answer, and a reverse proxy sees an idle
connection it is free to close. Both were invisible while answers took
seconds and would surface the first time one takes a minute behind nginx.

## Design

**Comments, not events.** An SSE comment is a line beginning with a colon;
every parser the repo ships (widget, SDK, eval HTTP target) ignores frames
that are not `data:` lines, and so does every third-party one. The wire type
`AnswerEvent` does not change, which is the point: this is transport, and
the SDK's consumers must not have to learn a new event to stay correct.

**One helper, two jobs** (`apps/web/lib/sse-heartbeat.ts`). `startHeartbeat`
writes `: open` synchronously when the stream starts, flushing headers with
the response, and then writes `: ping` after every fifteen seconds without a
real write. Real writes call `touch()`, so a streaming answer sends no pings.
The route stops the heartbeat before it closes the controller; a write after
close throws, and that is the one way this could take an answer down.

**Polled, not reset per token.** The timer ticks at a third of the interval
and checks the time of the last write, rather than being restarted on every
token: the churn buys nothing, and a ping a few seconds late is still far
inside any proxy's idle timeout.

**The client can leave first** (2026-09-14, later the same day). The route
stopped the heartbeat only on its own way out. When the widget aborted the
request mid-answer — closing the panel, sending a new question — the
controller closed, the timer ticked on, `enqueue` threw inside a timer
callback, and a timer has no caller to throw to: the process died with
`ERR_INVALID_STATE`. Three changes, each sufficient on its own. Every write
in the route goes through one guard that turns the first failure into
silence and stops the timer, and the answer is still persisted — it was
generated and paid for. The stream's `cancel()` stops the timer, which is
the hook that runs when the client disconnects. And the helper stops
itself when a write throws, so no future caller can repeat the mistake.

## Non-goals

- A `status` event narrating retrieval and generation. The stages it would
  describe take under half a second combined; the wait is the model, and the
  widget already shows a pending state from the moment a question is sent.
- Configurable interval. Fifteen seconds sits under every default proxy
  timeout in common use; a knob would exist to be set wrong.

## Verify

- The opening comment is written synchronously, before any event.
- No ping while real writes arrive inside the interval; pings once per
  interval through a long silence; nothing after `stop()`.
- A live question through the widget still renders tokens, citations and
  the done event unchanged, and `curl -N` shows `: open` immediately.
