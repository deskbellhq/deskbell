import { Badge } from "@deskbell/ui/components/badge";
import { Star } from "lucide-react";

import { GITHUB_URL } from "@/lib/links";

/**
 * Star-count badge for the sidebar card (spec: dashboard-ia-settings).
 * Rendered behind Suspense by the dashboard layout, so a slow GitHub call
 * never blocks paint — and any failure (private repo pre-launch, air-gapped
 * instance, rate limit) renders nothing rather than an error.
 */
export async function GitHubStars() {
  try {
    const res = await fetch(`https://api.github.com/repos${new URL(GITHUB_URL).pathname}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "deskbell-dashboard" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const repo = (await res.json()) as { stargazers_count?: number };
    if (typeof repo.stargazers_count !== "number") return null;
    return (
      <Badge variant="secondary">
        <Star />
        {Intl.NumberFormat("en", { notation: "compact" }).format(repo.stargazers_count)}
      </Badge>
    );
  } catch {
    return null;
  }
}
