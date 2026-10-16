import { publicKeySet } from "@/lib/actions/identity-token";
import { getDb } from "@/lib/db";

/**
 * The keys this instance signs visitor identity tokens with (spec:
 * mcp-actions, Identity). Public and cacheable: an MCP server fetches it once
 * and refreshes on an unknown key id. Not a widget endpoint — no project key,
 * no guard — because it discloses nothing about a project.
 */
export async function GET() {
  const keys = await publicKeySet(getDb());
  return Response.json(keys, {
    headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" },
  });
}
