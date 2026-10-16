import { PingRequestSchema } from "@deskbell/shared";

import { recordInstall } from "@/lib/installs";
import { preflight } from "@/lib/widget-cors";
import { guardWidgetRequest } from "@/lib/widget-guard";

/**
 * Public widget install beacon (spec: single-tag-embed-deploy-onboarding) —
 * the widget fires it once per tab session on mount. The row it records is
 * what tells the Deploy page an embed is live *before* anyone has asked
 * anything; /api/v1/ask records the same row for clients that never mount the
 * widget. Both go through lib/installs.ts, which owns the cap and the origin
 * normalisation — see there for why they share one implementation.
 *
 * No LLM spend, and guarded as `kind: "beacon"` (spec: widget-abuse-protection):
 * bot filtering and the per-IP rate limit apply, the origin allowlist
 * deliberately does not. Enforcing it here would silence the one message an
 * operator needs on a fresh install — "your widget is live on X, which is not
 * in your allowlist" — exactly when no origins are configured yet. That is the
 * same reason recordInstall() takes non-allowlisted origins on purpose; the
 * beacon is the only caller that can still reach it with one.
 */

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = PingRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(null, { status: 400, headers: { "access-control-allow-origin": "*" } });
  }

  const guard = await guardWidgetRequest(request, {
    projectKey: parsed.data.projectKey,
    kind: "beacon",
  });
  if (!guard.ok) return guard.response;

  await recordInstall(guard.project, request.headers.get("origin"));

  return new Response(null, { status: 204, headers: guard.cors });
}
