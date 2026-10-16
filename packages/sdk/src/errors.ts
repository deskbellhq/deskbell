/**
 * A non-2xx answer from the Deskbell server. `status` is the HTTP status;
 * `retryAfter` is the `retry-after` header in seconds when the server sent one
 * (rate limits and daily budgets do, see spec: widget-abuse-protection).
 */
export class DeskbellError extends Error {
  readonly status: number;
  readonly retryAfter: number | null;

  constructor(status: number, message?: string, retryAfter: number | null = null) {
    super(message ?? `Deskbell request failed: HTTP ${status}`);
    this.name = "DeskbellError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function retryAfterSeconds(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : null;
}
