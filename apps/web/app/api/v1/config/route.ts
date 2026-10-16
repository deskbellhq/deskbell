import { canHideBranding } from "@deskbell/ee";

import { preflight } from "@/lib/widget-cors";
import { guardWidgetRequest } from "@/lib/widget-guard";

/**
 * Public widget endpoint — the appearance a project's admin authored in the
 * dashboard, so rebranding never means editing the embed code (spec:
 * widget-customization).
 *
 * GET, unlike the other v1 endpoints: the response is public, identical for
 * every visitor, and cacheable, and a header-less GET is a CORS simple request
 * so it costs no preflight. There is nothing secret here — the widget renders
 * it, so anyone can read it off the page anyway.
 *
 * Cheap (one indexed read, no LLM spend) but still public, so it takes the read
 * guard: origin binding, bot filtering, and the per-IP read rate limit
 * (spec: widget-abuse-protection).
 *
 * Note the GET consequence for origin binding: a SAME-origin GET carries no
 * Origin header at all, so requiring one would break every self-hoster serving
 * the widget from the same domain as the API the moment they lock down origins.
 * checkOrigin() allows it — a response with no CORS grant cannot be read
 * cross-origin anyway.
 */

export const OPTIONS = preflight;

const CACHE = "public, max-age=60, stale-while-revalidate=300";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) {
    return Response.json(
      { error: "Missing key" },
      { status: 400, headers: { "access-control-allow-origin": "*" } },
    );
  }

  const guard = await guardWidgetRequest(request, { projectKey: key, kind: "read" });
  if (!guard.ok) return guard.response;

  // Branding is decided here, never by the client: the widget renders what it
  // is told, which keeps the MIT bundle free of any licence logic.
  return Response.json(
    { ...guard.project.appearance, poweredBy: !canHideBranding() },
    { headers: { ...guard.cors, "cache-control": CACHE } },
  );
}
