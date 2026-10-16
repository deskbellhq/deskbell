import { widgetInstalls } from "@deskbell/db";
import { Alert, AlertDescription, AlertTitle } from "@deskbell/ui/components/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@deskbell/ui/components/tabs";
import { and, asc, eq } from "drizzle-orm";
import { TriangleAlert } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { CopyButton } from "@/components/copy-button";
import { InstallStatus } from "@/components/install-status";
import { OriginAllowlist } from "@/components/origin-allowlist";
import { PageHeader } from "@/components/page-header";
import { TokenBudget } from "@/components/token-budget";
import { tokensUsedToday } from "@/lib/abuse/budget";
import { abuseConfig } from "@/lib/abuse/config";
import { getPublicBaseUrl, getRequestOrigin, getSelfHosts } from "@/lib/base-url";
import { getDb } from "@/lib/db";
import { hasAnsweredQuestion } from "@/lib/onboarding";
import { getDefaultProject } from "@/lib/org";
import { manualSnippet, oneTagSnippet } from "@/lib/widget-snippet";

export const dynamic = "force-dynamic";

/**
 * Install — install the widget, control who may use it, cap what it can spend
 * (specs: single-tag-embed-deploy-onboarding + widget-customization).
 */
export default async function InstallPage() {
  const project = await getDefaultProject();
  const db = getDb();
  const [installs, baseUrl, requestOrigin, appHosts, asked, usedToday] = await Promise.all([
    db
      .select({ origin: widgetInstalls.origin, lastSeenAt: widgetInstalls.lastSeenAt })
      .from(widgetInstalls)
      .where(and(eq(widgetInstalls.orgId, project.orgId), eq(widgetInstalls.projectId, project.id)))
      .orderBy(asc(widgetInstalls.firstSeenAt)),
    getPublicBaseUrl(),
    getRequestOrigin(),
    getSelfHosts(),
    hasAnsweredQuestion(project),
    tokensUsedToday(db, project.id, project.orgId),
  ]);
  // Whether an empty allowlist blocks the widget or answers everyone is a
  // deployment property, so the warning below has to say which one this is
  // (spec: widget-abuse-protection).
  const blockedWhenUnconfigured = abuseConfig().isProduction && !abuseConfig().allowAnyOrigin;

  const oneTag = oneTagSnippet(baseUrl, project.publicKey);
  const manual = manualSnippet(baseUrl, project.publicKey);
  const listening = project.allowedOrigins.some((o) => !installs.some((i) => i.origin === o));

  return (
    <>
      <PageHeader
        title="Install"
        description="Install the widget, control where it may run, and cap what it can spend."
      />
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Install the widget</h2>
          <p className="text-sm text-muted-foreground">
            One tag, anywhere before <code>&lt;/body&gt;</code>. The script is served by this
            deployment, so it knows where its API lives — nothing else to configure.
          </p>
        </div>
        <Tabs defaultValue="script">
          <TabsList>
            <TabsTrigger value="script">Script tag</TabsTrigger>
            <TabsTrigger value="manual">Manual element (advanced)</TabsTrigger>
          </TabsList>
          <TabsContent value="script" className="flex flex-col items-start gap-2">
            <pre className="w-full overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
              <code>{oneTag}</code>
            </pre>
            <CopyButton text={oneTag} label="Copy snippet" />
          </TabsContent>
          <TabsContent value="manual" className="flex flex-col items-start gap-2">
            <pre className="w-full overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
              <code>{manual}</code>
            </pre>
            <div className="flex w-full items-center justify-between gap-3">
              <CopyButton text={manual} label="Copy snippet" />
              <p className="text-xs text-muted-foreground">
                Place the element yourself; theme via <code>--deskbell-*</code> CSS variables or the
                Appearance page.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Project key</h2>
          <p className="text-sm text-muted-foreground">
            This key is public — it ships in your page source. Origin binding below is the access
            control, not key secrecy.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <code className="rounded-md bg-muted px-3 py-1.5 font-mono text-xs">
            {project.publicKey}
          </code>
          <CopyButton text={project.publicKey} label="Copy key" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Allowed origins</h2>
          <p className="text-sm text-muted-foreground">
            The widget answers only from these sites, plus this dashboard. Entries are exact origins
            — scheme, host, and port.
          </p>
        </div>
        {project.allowedOrigins.length === 0 && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>No origins configured</AlertTitle>
            <AlertDescription>
              {blockedWhenUnconfigured
                ? "This dashboard still works, but the widget is blocked on every other site until you add an origin — this deployment refuses to answer an unconfigured project."
                : "The widget currently answers requests from any origin. Add your site's origin to lock it down before going live."}
            </AlertDescription>
          </Alert>
        )}
        <OriginAllowlist origins={project.allowedOrigins} selfOrigin={requestOrigin} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Install verification</h2>
          <p className="text-sm text-muted-foreground">
            The widget reports in when it loads, and again whenever it answers a question — so an
            allowed origin verifies either way, whichever client is rendering it. No clicking around
            your own site required.
          </p>
        </div>
        <InstallStatus
          allowedOrigins={project.allowedOrigins}
          installs={installs}
          appHosts={appHosts}
          asked={asked}
        />
        {listening && <AutoRefresh />}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Limits</h2>
          <p className="text-sm text-muted-foreground">
            A ceiling on what the widget may spend for this project in a day. Once it is reached the
            widget tells visitors to try again later instead of answering. Request rate limits are
            separate and set by whoever runs this deployment — see the{" "}
            <a
              className="underline underline-offset-4"
              href="https://deskbell.dev/docs/manage/security"
              target="_blank"
              rel="noreferrer"
            >
              security guide
            </a>
            .
          </p>
        </div>
        <TokenBudget budget={project.dailyTokenBudget} usedToday={usedToday} />
      </section>
    </>
  );
}
