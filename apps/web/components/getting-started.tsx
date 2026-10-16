import type { ProviderStatus } from "@deskbell/core/models";
import { Alert, AlertDescription, AlertTitle } from "@deskbell/ui/components/alert";
import { Badge } from "@deskbell/ui/components/badge";
import { Button } from "@deskbell/ui/components/button";
import { Check, CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { dismissOnboarding } from "@/app/(dashboard)/actions";
import type { DashboardRole } from "@/lib/auth/permissions";
import {
  DOCS_MODELS_URL,
  DOCS_QUICKSTART_PROBLEMS_URL,
  DOCS_WIDGET_INSTALL_URL,
} from "@/lib/links";
import type { OnboardingDetails, OnboardingStatus } from "@/lib/onboarding";
import { type OnboardingStage, onboardingPending } from "@/lib/onboarding-stage";
import { agentPrompt, oneTagSnippet } from "@/lib/widget-snippet";

import { AddOriginForm } from "./add-origin-form";
import { AddSourceForm } from "./add-source-form";
import { AskWidgetButton } from "./ask-widget-button";
import { AutoRefresh } from "./auto-refresh";
import { CopyButton } from "./copy-button";
import { ListeningDot } from "./install-status";

/**
 * The Overview until the widget is live on the operator's own site (spec:
 * overview-getting-started). One pill for where the project is, three
 * numbered steps with the real artifacts inline, and nothing else: the stat
 * cards, chart and table wait behind it. Every state is derived server-side
 * from live rows, so the page corrects itself as the worker indexes, the
 * widget answers, and the install beacon lands; `AutoRefresh` runs only
 * while one of those can still happen without the operator.
 *
 * Forms are client components because they use useActionState; the rest
 * renders on the server.
 */

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="underline underline-offset-4" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function StagePill({ stage }: { stage: OnboardingStage }) {
  const icon =
    stage.tone === "busy" ? (
      <ListeningDot />
    ) : stage.tone === "success" ? (
      <CheckCircle2 className="fill-certain stroke-card" />
    ) : stage.tone === "destructive" ? (
      <TriangleAlert className="text-destructive" />
    ) : (
      <span className="size-2 rounded-full bg-muted-foreground/60" aria-hidden="true" />
    );
  return (
    <Badge variant="outline" role="status" className="gap-1.5 px-2.5 py-1 text-muted-foreground">
      {icon}
      {stage.label}
    </Badge>
  );
}

/**
 * Only the providers that are not ready are worth a line. Two models on the
 * same provider share one variable and get one warning, not two.
 */
function ModelKeyWarning({
  providers,
}: {
  providers: { chat: ProviderStatus; embedding: ProviderStatus };
}) {
  const missing = [
    { what: "chat model", status: providers.chat },
    { what: "embedding model", status: providers.embedding },
  ].filter(({ status }) => !status.configured);
  if (missing.length === 0) return null;
  const seen = new Set<string>();
  const lines = missing.filter(({ status }) => {
    const key = status.keyEnv ?? status.provider;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>Model key missing</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-1">
          {lines.map(({ what, status }) => (
            <p key={status.id}>
              {status.keyEnv ? (
                <>
                  The {what} (<code>{status.id}</code>) needs <code>{status.keyEnv}</code>, which is
                  not set.
                </>
              ) : (
                <>
                  The {what} (<code>{status.id}</code>) names a provider this deployment does not
                  wire.
                </>
              )}
            </p>
          ))}
          <p>
            Indexing will stall and the widget cannot answer until this is fixed. See{" "}
            <ExternalLink href={DOCS_MODELS_URL}>models and providers</ExternalLink>.
          </p>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function Step({
  number,
  done,
  last = false,
  title,
  children,
}: {
  number: number;
  done: boolean;
  last?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-4 pb-10 last:pb-0">
      {!last && (
        <span aria-hidden="true" className="absolute top-8 bottom-0 left-4 w-px bg-border" />
      )}
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium ${
          done ? "border-primary bg-primary text-primary-foreground" : "bg-background"
        }`}
      >
        {done ? <Check className="size-4" /> : number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {children}
      </div>
    </li>
  );
}

function SourceProgress({ sources }: { sources: OnboardingDetails["sources"] }) {
  return (
    <ul className="flex flex-col gap-2">
      {sources.map((source) => {
        const pages = `${source.docCount} ${source.docCount === 1 ? "page" : "pages"}`;
        const busy = source.status === "pending" || source.status === "syncing";
        return (
          <li key={source.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {busy ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            ) : source.status === "ready" ? (
              <CheckCircle2 className="size-4 shrink-0 fill-certain stroke-card" />
            ) : (
              <TriangleAlert className="size-4 shrink-0 text-destructive" />
            )}
            <span className="min-w-0 truncate font-mono text-xs">{source.url ?? source.id}</span>
            <span className="text-muted-foreground">
              {busy
                ? source.docCount === 0
                  ? "Indexing… fetching the first pages"
                  : `Indexing… ${pages} so far`
                : source.status === "ready"
                  ? `Ready · ${pages}`
                  : "Crawl failed"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function GettingStarted({
  status,
  details,
  stage,
  baseUrl,
  projectKey,
  role,
  providers,
  blockedWhenUnconfigured,
}: {
  status: OnboardingStatus;
  details: OnboardingDetails;
  stage: OnboardingStage;
  baseUrl: string;
  projectKey: string;
  role: DashboardRole;
  providers: { chat: ProviderStatus; embedding: ProviderStatus };
  /** Whether this deployment refuses a project with an empty allowlist. */
  blockedWhenUnconfigured: boolean;
}) {
  const isAdmin = role === "owner" || role === "admin";
  const canEdit = isAdmin || role === "editor";
  const snippet = oneTagSnippet(baseUrl, projectKey);
  const everySourceFailed =
    details.sources.length > 0 && details.sources.every((s) => s.status === "error");
  const showSourceForm = canEdit && (details.sources.length === 0 || everySourceFailed);
  const syncing = details.sources.some((s) => s.status === "pending" || s.status === "syncing");
  const first = details.firstAnswer;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-8 lg:px-6">
      <ModelKeyWarning providers={providers} />

      <header className="flex flex-col items-center gap-3 text-center">
        <StagePill stage={stage} />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Get your first answer in about a minute
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Point Deskbell at your docs, try it right here, then put it on your site. Each step checks
          itself off as it happens.
        </p>
      </header>

      <ol className="flex flex-col">
        <Step number={1} done={status.sourceReady} title="Add your docs">
          <p className="text-sm text-muted-foreground">
            Paste the URL of a documentation site you control. Deskbell crawls it, splits every page
            into chunks and embeds them; the source is ready when the last chunk is stored.
          </p>
          {showSourceForm && <AddSourceForm />}
          {!canEdit && details.sources.length === 0 && (
            <p className="text-sm text-muted-foreground">
              An editor adds the first docs site here.
            </p>
          )}
          {details.sources.length > 0 && <SourceProgress sources={details.sources} />}
          {syncing && (
            <p className="text-xs text-muted-foreground">
              Taking longer than a few minutes? Check the worker logs — a rejected model key fails
              here first. See{" "}
              <ExternalLink href={DOCS_QUICKSTART_PROBLEMS_URL}>common problems</ExternalLink>.
            </p>
          )}
          {everySourceFailed && (
            <p className="text-xs text-muted-foreground">
              The crawl stopped before it stored a page.{" "}
              <Link className="underline underline-offset-4" href="/sources">
                Retry it under Sources
              </Link>
              , or see{" "}
              <ExternalLink href={DOCS_QUICKSTART_PROBLEMS_URL}>common problems</ExternalLink>.
            </p>
          )}
        </Step>

        <Step number={2} done={status.asked} title="Ask it something">
          {status.asked && first ? (
            <p className="text-sm text-muted-foreground">
              {first.question ? (
                <>
                  You asked <q className="text-foreground">{first.question}</q>
                </>
              ) : (
                "Your first question landed"
              )}
              {first.refused
                ? " — Deskbell declined rather than guessing, which is the product working."
                : first.citations > 0
                  ? ` — answered with ${first.citations} ${first.citations === 1 ? "source" : "sources"}.`
                  : " — answered."}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {status.sourceReady
                  ? "The dashboard runs the real widget. Ask something your docs answer, then something they don't — a refusal is the product working."
                  : "Unlocks once your first source finishes indexing."}
              </p>
              <div>
                <AskWidgetButton disabled={!status.sourceReady} />
              </div>
            </>
          )}
        </Step>

        <Step number={3} done={status.widgetLive} title="Put it on your site">
          <p className="text-sm text-muted-foreground">
            One tag, anywhere before <code>&lt;/body&gt;</code>. The script is served by this
            deployment, so it knows where its API lives.
          </p>
          <pre className="w-full overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
            <code>{snippet}</code>
          </pre>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={snippet} label="Copy snippet" />
            <CopyButton
              text={agentPrompt(baseUrl, projectKey)}
              label="Copy prompt for your coding agent"
            />
            <ExternalLink href={DOCS_WIDGET_INSTALL_URL}>
              <span className="text-xs text-muted-foreground">Install docs</span>
            </ExternalLink>
          </div>

          {status.originAllowed ? (
            <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-3 py-3">
              <span className="mt-1 flex">
                {status.widgetLive ? (
                  <CheckCircle2 className="size-4 fill-certain stroke-card" />
                ) : (
                  <ListeningDot />
                )}
              </span>
              <div className="flex flex-col gap-0.5 text-sm">
                <span className="font-medium">
                  {status.widgetLive ? "Widget is live" : "Listening for your widget"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {status.widgetLive
                    ? `Verified on ${status.firstForeignOrigin}.`
                    : "Open any page on your site with the tag in place. This ticks itself the moment the widget loads there."}{" "}
                  <Link className="underline underline-offset-4" href="/settings/install">
                    Install settings
                  </Link>
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {blockedWhenUnconfigured
                  ? "Your site's origin is required: this deployment refuses to answer a project with an empty allowlist."
                  : "Allow your site's origin before going public — until then the widget answers from any origin."}{" "}
                Exact scheme, host and port.
              </p>
              {isAdmin ? (
                <AddOriginForm />
              ) : (
                <p className="text-sm text-muted-foreground">
                  An admin allows the origin under{" "}
                  <Link className="underline underline-offset-4" href="/settings/install">
                    Settings › Install
                  </Link>
                  .
                </p>
              )}
            </div>
          )}
        </Step>

        <Step number={4} done={details.actionServers > 0} last title="Connect an action (optional)">
          <p className="text-sm text-muted-foreground">
            Attach an MCP server and the widget can look up a visitor's order or open a ticket for
            them, each tool switched on by you. Skip this until you have something for it to do.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/actions"
              className="text-sm font-medium underline underline-offset-4 hover:text-foreground"
            >
              {details.actionServers > 0 ? "Manage actions" : "Open Actions"}
            </Link>
          </div>
        </Step>
      </ol>

      <div className="flex justify-center">
        {canEdit ? (
          <form action={dismissOnboarding}>
            <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
              Skip to overview
            </Button>
          </form>
        ) : (
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href="/conversations">Open conversations</Link>
          </Button>
        )}
      </div>

      {onboardingPending(status) && <AutoRefresh />}
    </div>
  );
}
