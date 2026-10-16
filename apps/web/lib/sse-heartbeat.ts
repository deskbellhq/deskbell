/**
 * Keeps an SSE response alive while the answer is still being written
 * (spec: sse-heartbeat).
 *
 * Two jobs. First, an opening comment flushes the response headers the moment
 * the stream is handed back, so the client learns "connected, working" at
 * once rather than at the first event — until then a slow answer and a hung
 * server look identical. Second, a comment every `intervalMs` of silence
 * keeps a reverse proxy from closing an idle connection mid-answer; the
 * common ones give up after a minute, and an answer that takes a minute is
 * exactly the one a self-hoster would otherwise see fail.
 *
 * SSE comments are lines beginning with a colon. Every parser ignores them,
 * so nothing here touches the wire type the widget and the SDK consume.
 */

export const SSE_OPEN_COMMENT = ": open\n\n";
export const SSE_PING_COMMENT = ": ping\n\n";
export const DEFAULT_HEARTBEAT_MS = 15_000;

export interface Heartbeat {
  /** Call after every real write; a ping is only sent after `intervalMs` without one. */
  touch(): void;
  /** Stop the timer. Must run before the stream closes: a write after close throws. */
  stop(): void;
}

export function startHeartbeat(
  write: (comment: string) => void,
  options: { intervalMs?: number; now?: () => number } = {},
): Heartbeat {
  const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_MS;
  const now = options.now ?? Date.now;
  write(SSE_OPEN_COMMENT);
  let lastWrite = now();
  // Polled at a fraction of the interval rather than reset on every token:
  // restarting a timer per token is churn for no gain, and a ping landing a
  // few seconds late is still well inside any proxy's patience.
  const tick = Math.max(1, Math.floor(intervalMs / 3));
  // A write that throws means the stream is gone — and a timer callback has
  // no caller to throw to, so the exception would be the process's. Stopping
  // is the only correct response; the route stops the heartbeat itself on
  // every path it knows about, and this covers the ones it does not.
  const timer = setInterval(() => {
    if (now() - lastWrite < intervalMs) return;
    try {
      write(SSE_PING_COMMENT);
    } catch {
      clearInterval(timer);
      return;
    }
    lastWrite = now();
  }, tick);
  return {
    touch() {
      lastWrite = now();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
