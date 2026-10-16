import { Badge } from "@deskbell/ui/components/badge";
import { Button } from "@deskbell/ui/components/button";
import { CheckCircle2, CircleAlert, CircleDashed, TriangleAlert } from "lucide-react";

import { allowOrigin } from "@/app/settings/install/actions";
import { hostOfOrigin } from "@/lib/base-url";

interface Install {
  origin: string;
  lastSeenAt: Date;
}

function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Live pulse — this origin is allowed and we are waiting for its first ping. */
export function ListeningDot() {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-amber-500 dark:bg-amber-400" />
    </span>
  );
}

/** Matches the status pills used in the conversations table. */
function StatusBadge({ state }: { state: "verified" | "pending" | "stray" }) {
  if (state === "verified") {
    return (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        <CheckCircle2 className="fill-certain stroke-card" />
        Verified
      </Badge>
    );
  }
  if (state === "pending") {
    return (
      <Badge variant="outline" className="gap-1.5 px-1.5 text-muted-foreground">
        <ListeningDot />
        Pending install
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="px-1.5 text-muted-foreground">
      <TriangleAlert className="text-amber-500 dark:text-amber-400" />
      Not allowed
    </Badge>
  );
}

/**
 * Per-origin install verification (spec: single-tag-embed-deploy-onboarding),
 * fed by widget_installs rows that /api/v1/ping (widget mounted) and
 * /api/v1/ask (question answered) both upsert. Server-rendered; pair with
 * <AutoRefresh /> while any origin is still listening.
 *
 * Verification is origin-keyed, so it can only see clients that send an Origin
 * header. A server-side caller sends none and is invisible by construction —
 * hence the `asked` signal: answers exist but no origin ever reported, which is
 * a real deployment we cannot name, not a missing one.
 *
 * The headline is the summary: "is my widget live?" is the only question this
 * section exists to answer, and it should be answerable without reading a list.
 */
export function InstallStatus({
  allowedOrigins,
  installs,
  appHosts,
  asked,
}: {
  allowedOrigins: string[];
  installs: Install[];
  /**
   * The deployment's own host(s) — the dashboard dogfoods the widget, so these
   * never count. Hosts rather than origins because the scheme the browser used
   * is not observable here; comparing origins behind a TLS-terminating proxy
   * reports the operator's own dashboard as a stray install.
   */
  appHosts: string[];
  /** Any assistant answer exists for this project, from any client. */
  asked: boolean;
}) {
  const byOrigin = new Map(installs.map((i) => [i.origin, i]));
  // Installs pinging from an origin nobody allowlisted: the classic misconfig
  // (widget deployed, allowlist forgotten). Recorded by the beacon on purpose.
  const strays = installs.filter((i) => {
    if (allowedOrigins.includes(i.origin)) return false;
    const host = hostOfOrigin(i.origin);
    return host !== null && !appHosts.includes(host);
  });
  const verified = allowedOrigins.filter((o) => byOrigin.has(o));
  const pending = allowedOrigins.filter((o) => !byOrigin.has(o));

  // Answers exist but nothing ever reported an origin: a server-side client.
  // Claiming "not installed" here is simply wrong, and it is the state a
  // custom UI built on @deskbell/sdk lands in.
  const headless = asked && installs.length === 0;

  const summary = headless
    ? {
        icon: <CircleAlert className="size-4 shrink-0 text-muted-foreground" />,
        title: "Answering questions — we can't tell from where",
        detail:
          "Requests are arriving without an Origin header, which is what a server-side client looks like. Verification is origin-keyed, so it cannot name this deployment. Nothing is wrong.",
      }
    : verified.length > 0
      ? {
          icon: <CheckCircle2 className="size-4 shrink-0 fill-certain stroke-card" />,
          title: pending.length === 0 ? "Widget is live" : "Widget is live on some sites",
          detail:
            pending.length === 0
              ? `Verified on ${verified.length} ${verified.length === 1 ? "origin" : "origins"}.`
              : `Verified on ${verified.length} of ${allowedOrigins.length} allowed origins — still waiting on ${pending.length}.`,
        }
      : allowedOrigins.length > 0
        ? {
            icon: <ListeningDot />,
            title: "Waiting for the first load",
            detail:
              "Add the snippet to your site and open any page. This flips to verified on its own — no clicking around required.",
          }
        : {
            icon: <CircleDashed className="size-4 shrink-0 text-muted-foreground" />,
            title: "Not installed yet",
            detail:
              "Allow your site's origin above, then paste the snippet. Verification starts the moment your widget loads there.",
          };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-3 py-3">
        <span className="mt-0.5 flex">{summary.icon}</span>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{summary.title}</span>
          <span className="text-xs text-muted-foreground">{summary.detail}</span>
        </div>
      </div>

      {allowedOrigins.length === 0 && strays.length === 0 ? null : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {allowedOrigins.map((origin) => {
            const install = byOrigin.get(origin);
            return (
              <li key={origin} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-mono text-xs">{origin}</span>
                <span className="ml-auto flex items-center gap-3">
                  {install ? (
                    <span className="text-xs text-muted-foreground">
                      Last seen {timeAgo(install.lastSeenAt)}
                    </span>
                  ) : null}
                  <StatusBadge state={install ? "verified" : "pending"} />
                </span>
              </li>
            );
          })}
          {strays.map((install) => (
            <li
              key={install.origin}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
            >
              <span className="font-mono text-xs">{install.origin}</span>
              <span className="ml-auto flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  Widget seen {timeAgo(install.lastSeenAt)}
                </span>
                <StatusBadge state="stray" />
                <form action={allowOrigin.bind(null, install.origin)}>
                  <Button type="submit" variant="outline" size="sm">
                    Allow
                  </Button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
